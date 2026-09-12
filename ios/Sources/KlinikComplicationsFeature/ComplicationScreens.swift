import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The clinician's queue of reports still waiting (spec M7).
public struct ComplicationQueueView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ComplicationQueueModel
    /// A short-lived link to one photograph. Supplied by the shell, which owns
    /// the photos API; nil leaves the thumbnails as counts.
    private let linkFor: ((String) async -> URL?)?
    /// Opening one. The viewer lives in the photos module, which this one does
    /// not import — the shell presents it.
    private let openPhoto: ((ClinicalPhoto) -> Void)?

    @State private var state = ComplicationsState()
    @State private var responding: ComplicationView?
    @State private var closing = false

    public init(
        model: ComplicationQueueModel,
        linkFor: ((String) async -> URL?)? = nil,
        openPhoto: ((ClinicalPhoto) -> Void)? = nil
    ) {
        self.model = model
        self.linkFor = linkFor
        self.openPhoto = openPhoto
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
        .refreshable { await refresh { await model.load() } }
        .navigationTitle(L10n.string("complication.queueTitle"))
        .sheet(item: $responding) { item in
            RespondSheet(
                item: item,
                title: L10n.string(closing ? "complication.resolve" : "complication.answer")
            ) { message in
                await refresh {
                    if closing {
                        await model.resolve(item.id, message: message)
                    } else {
                        await model.acknowledge(item.id, message: message)
                    }
                }
                responding = nil
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .empty:
            MessageState(icon: "checkmark.circle", text: L10n.string("complication.queueEmpty"))

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("error.notFound"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await refresh { await model.load() }
            }

        case .loaded:
            queue
        }
    }

    private var queue: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                if state.overdueCount > 0 {
                    Label(
                        String(
                            format: L10n.string("complication.overdueCount"),
                            state.overdueCount
                        ),
                        systemImage: Tokens.State.triageUrgent.iconName
                    )
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                }

                if let error = state.error {
                    ErrorBanner(message: error)
                }

                // Cards, like every other clinical list in the app. A plain
                // list put an unanswered six-hour-old report and a forty-minute
                // one at exactly the same weight.
                ForEach(state.items) { item in
                    ComplicationRow(
                        item: item,
                        isWorking: state.working == item.id,
                        linkFor: linkFor,
                        openPhoto: openPhoto
                    ) {
                        closing = false
                        responding = item
                    } onResolve: {
                        closing = true
                        responding = item
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

/**
 * One report, as a card.
 *
 * The row used to be a plain list entry: a name, a sentence, the wait in raw
 * minutes, and — where the patient had attached photographs of the wound —
 * the words "2 fotoğraf", which could not be opened. The photographs are the
 * evidence; a queue that counts them and will not show them sends a clinician
 * to look for the patient's gallery instead.
 */
struct ComplicationRow: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize

    let item: ComplicationView
    let isWorking: Bool
    let linkFor: ((String) async -> URL?)?
    let openPhoto: ((ClinicalPhoto) -> Void)?
    let onAnswer: () -> Void
    let onResolve: () -> Void

    var body: some View {
        Card(tone: tone) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                header

                Text(item.complication.note)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)

                if !item.photos.isEmpty {
                    photographs
                }

                if let response = item.complication.firstResponse {
                    Text("\(L10n.string("complication.answered")): \(response)")
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }

                actions
            }
        }
    }

    /// Whose report, how long, and what state it is in — the three things a
    /// clinician triages on.
    private var header: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            AdaptiveStack(stacked: typeSize.isAccessibilitySize, spacing: Tokens.Spacing.sm) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    // Whose report it is, first and largest. This queue is
                    // clinic-wide: a row that opened with a body area left a
                    // clinician reading "karın" with no idea whose abdomen.
                    Text(item.patient.fullName)
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)

                    Text(
                        "\(item.patient.mrn) · "
                            + (item.complication.bodyArea
                                ?? L10n.string("complication.noBodyArea"))
                    )
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: Tokens.Spacing.sm)

                // How long, in words as well as colour: a wait a reader cannot
                // distinguish by hue is no signal at all (spec section 7).
                Text(item.localizedWait)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(
                        (item.overdue ? Tokens.Palette.warning : Tokens.Palette.textSecondary)
                            .resolve(for: scheme)
                    )
                    .fixedSize(horizontal: false, vertical: true)
            }

            FlowRow(spacing: Tokens.Spacing.xs) {
                Badge(item.complication.status.localizedName, tone: tone)

                if item.overdue {
                    Badge(
                        L10n.string("complication.overdue"),
                        tone: .warning,
                        symbol: Tokens.State.triageUrgent.iconName
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The photographs, small and openable. Without a link loader the shell
    /// has not offered one, and the count stands as it did.
    @ViewBuilder
    private var photographs: some View {
        if let linkFor {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Tokens.Spacing.sm) {
                    ForEach(item.photos) { photo in
                        Button {
                            openPhoto?(photo)
                        } label: {
                            ComplicationThumbnail(photoId: photo.id, linkFor: linkFor)
                        }
                        .buttonStyle(.plain)
                        .disabled(openPhoto == nil)
                        .accessibilityLabel(L10n.string("complication.openPhoto"))
                    }
                }
            }
        } else {
            Label(
                String(format: L10n.string("complication.photoCount"), item.photos.count),
                systemImage: "photo"
            )
            .font(Tokens.Typography.captionRelative)
            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
        }
    }

    @ViewBuilder
    private var actions: some View {
        AdaptiveStack(stacked: typeSize.isAccessibilitySize, spacing: Tokens.Spacing.md) {
            if item.complication.acknowledgedAt == nil {
                Button(L10n.string("complication.answer"), action: onAnswer)
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)
            }

            if item.complication.status != .resolved {
                Button(L10n.string("complication.resolve"), action: onResolve)
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)
            }

            Spacer(minLength: 0)
        }
    }

    /// Unanswered past the threshold shouts; answered recedes; the rest is
    /// ordinary.
    private var tone: Tone {
        if item.overdue { return .warning }
        if item.complication.status == .resolved { return .success }

        return .neutral
    }
}

/// One attached photograph, behind a link that expires.
struct ComplicationThumbnail: View {
    @Environment(\.colorScheme) private var scheme

    let photoId: String
    let linkFor: (String) async -> URL?

    @State private var url: URL?
    @State private var failed = false

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        placeholder
                    default:
                        ProgressView().accessibilityLabel(L10n.string("common.loading"))
                    }
                }
            } else if failed {
                placeholder
            } else {
                ProgressView().accessibilityLabel(L10n.string("common.loading"))
            }
        }
        .frame(width: 88, height: 88)
        .background(Tokens.Palette.surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .task {
            url = await linkFor(photoId)
            failed = url == nil
        }
    }

    private var placeholder: some View {
        Image(systemName: "photo.badge.exclamationmark")
            .font(Tokens.Typography.calloutRelative)
            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            .accessibilityHidden(true)
    }
}

/// Answering or closing a report.
struct RespondSheet: View {
    @Environment(\.colorScheme) private var scheme

    let item: ComplicationView
    let title: String
    let onSend: (String) async -> Void

    @State private var message = ""

    var body: some View {
        FormScaffold(title: title, subtitle: item.complication.note) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("complication.yourAnswer"),
                    text: $message,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                PrimaryButton(
                    title: L10n.string("common.send"),
                    isBusy: false,
                    isEnabled: !message.trimmingCharacters(in: .whitespaces).isEmpty
                ) {
                    await onSend(message)
                }
            }
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
    }
}

/// The patient's side: reporting, and seeing what the clinic said back.
public struct MyComplicationsView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: MyComplicationsModel

    @State private var state = ComplicationsState()
    @State private var note = ""
    @State private var bodyArea = ""

    public init(model: MyComplicationsModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                // The form first: someone opening this screen is usually here
                // to report something, not to browse what they reported before.
                reportForm

                if let error = state.error {
                    ErrorBanner(message: error)
                }

                // Not an error banner: the report is safe. But it has not been
                // read by anybody, and the one thing a patient must be told
                // here is what to do if waiting is not an option.
                if state.queued {
                    QueuedReportNotice()
                }

                ForEach(state.items) { item in
                    MyComplicationRow(item: item)
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
        .refreshable { await refresh { await model.load() } }
        .navigationTitle(L10n.string("complication.myTitle"))
    }

    private var reportForm: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Text(L10n.string("complication.reportTitle"))
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            Text(L10n.string("complication.reportHint"))
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            LabelledField(
                label: L10n.string("complication.whatIsWrong"),
                text: $note,
                isSecure: false,
                contentType: .plain,
                keyboard: .default
            )

            LabelledField(
                label: L10n.string("complication.bodyArea"),
                text: $bodyArea,
                isSecure: false,
                contentType: .plain,
                keyboard: .default
            )

            PrimaryButton(
                title: L10n.string("complication.send"),
                isBusy: state.submitting,
                isEnabled: !note.trimmingCharacters(in: .whitespaces).isEmpty && !state.submitting
            ) {
                let sent = await refreshReturning {
                    await model.report(
                        note: note,
                        bodyArea: bodyArea.isEmpty ? nil : bodyArea
                    )
                }

                if sent {
                    note = ""
                    bodyArea = ""
                }
            }
        }
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }

    private func refreshReturning(_ work: () async -> Bool) async -> Bool {
        let result = await work()
        state = await model.currentState()
        return result
    }
}

struct MyComplicationRow: View {
    @Environment(\.colorScheme) private var scheme

    let item: ComplicationView

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(item.complication.status.localizedName)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                Spacer()

                Text(item.complication.reportedAt, style: .date)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            Text(item.complication.note)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            // The reply, shown plainly. A patient who cannot see an answer
            // reports the same worry again.
            if let response = item.complication.firstResponse {
                Text(response)
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                    .padding(Tokens.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Tokens.Palette.successSurface.resolve(for: scheme))
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            } else {
                Text(L10n.string("complication.awaitingReply"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}


/**
 * A complaint the phone is holding.
 *
 * Says two things, and the second one is why this view exists rather than a
 * generic "kaydedildi": the report is safe, and nobody at the clinic has seen
 * it. A patient whose wound is opening should not be waiting on a queue, and
 * the only honest thing an offline app can do is say so and give them the
 * telephone.
 */
struct QueuedReportNotice: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Card(tone: .warning) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(Tokens.Typography.bodyRelative)
                        // The sentence beside it says the same thing.
                        .accessibilityHidden(true)

                    Text(L10n.string("sync.savedOffline"))
                        .font(Tokens.Typography.bodyRelative)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(L10n.string("sync.urgentWarning"))
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The clinician's queue of reports still waiting (spec M7).
public struct ComplicationQueueView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ComplicationQueueModel

    @State private var state = ComplicationsState()
    @State private var responding: ComplicationView?
    @State private var closing = false

    public init(model: ComplicationQueueModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
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
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            if state.overdueCount > 0 {
                Label(
                    L10n.string("complication.overdueCount") + ": \(state.overdueCount)",
                    systemImage: Tokens.State.triageUrgent.iconName
                )
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                .padding(.horizontal, Tokens.Spacing.lg)
                .padding(.top, Tokens.Spacing.lg)
            }

            if let error = state.error {
                ErrorBanner(message: error).padding(.horizontal, Tokens.Spacing.lg)
            }

            List {
                ForEach(state.items) { item in
                    ComplicationRow(item: item, isWorking: state.working == item.id) {
                        closing = false
                        responding = item
                    } onResolve: {
                        closing = true
                        responding = item
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

struct ComplicationRow: View {
    @Environment(\.colorScheme) private var scheme

    let item: ComplicationView
    let isWorking: Bool
    let onAnswer: () -> Void
    let onResolve: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(item.complication.bodyArea ?? L10n.string("complication.noBodyArea"))
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer()

                // How long the patient has been waiting, in words as well as
                // colour: a wait a reader cannot distinguish by hue is no
                // signal at all (spec section 7).
                Text(waitingText)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(
                        (item.overdue ? Tokens.Palette.warning : Tokens.Palette.textSecondary)
                            .resolve(for: scheme)
                    )
            }

            Text(item.complication.note)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            if !item.photos.isEmpty {
                Label(
                    "\(item.photos.count) \(L10n.string("complication.photoCount"))",
                    systemImage: "photo"
                )
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            if let response = item.complication.firstResponse {
                Text("\(L10n.string("complication.answered")): \(response)")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
            }

            HStack(spacing: Tokens.Spacing.md) {
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
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var waitingText: String {
        if let answered = item.responseMinutes {
            return "\(L10n.string("complication.respondedIn")) \(answered) \(L10n.string("common.minutesShort"))"
        }

        return "\(L10n.string("complication.waiting")) \(item.waitingMinutes) \(L10n.string("common.minutesShort"))"
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

                ForEach(state.items) { item in
                    MyComplicationRow(item: item)
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
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

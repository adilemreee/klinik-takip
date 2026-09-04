import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The patient's permissions (KVKK, spec §8).
 *
 * The layout follows the Board's principle decision 2026/347 rather than
 * convenience, and the difference is visible:
 *
 *   - The **privacy notice** is its own section and takes only an
 *     acknowledgement that it was read. It is not a checkbox to agree to.
 *     Asking for agreement to a notice is exactly what the decision forbids.
 *   - The **consents** are separate, one decision each, and none of them is
 *     bundled with anything. A single "I accept everything" is how a consent
 *     stops being freely given.
 *   - Nothing is offered for processing that rests on another legal ground.
 *     Treatment is not on this screen, and neither is data processing.
 *
 * And it says, once and plainly, that refusing costs the patient nothing.
 */
public struct ConsentsView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ConsentsModel
    /// Opens the full privacy notice, supplied by the shell.
    private let openNotice: () -> Void

    @State private var state = ConsentsState()
    @State private var noticeAcknowledged = false

    public init(model: ConsentsModel, openNotice: @escaping () -> Void) {
        self.model = model
        self.openNotice = openNotice
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("consent.title"))
        .task { await refresh { await model.load() } }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("home.noPatientFile"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await refresh { await model.load() }
            }

        case .loaded:
            loaded
        }
    }

    private var loaded: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                if let error = state.error {
                    ErrorBanner(message: error)
                }

                notice
                Divider()
                consents
            }
            .padding(Tokens.Spacing.lg)
        }
    }

    /// The notice. Read, not agreed to.
    private var notice: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            Text(L10n.string("consent.noticeTitle"))
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .accessibilityAddTraits(.isHeader)

            Text(L10n.string("consent.noticeBody"))
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Button(L10n.string("consent.noticeTitle"), action: openNotice)
                .frame(minHeight: Tokens.minimumTouchTarget)

            if noticeAcknowledged {
                Label(L10n.string("consent.noticeAcknowledged"), systemImage: "checkmark.circle")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
            } else {
                // A button, not a switch, and its title is "I have read this" —
                // never "I agree". The distinction is the whole point.
                Button(L10n.string("consent.noticeRead")) { noticeAcknowledged = true }
                    .buttonStyle(.bordered)
                    .frame(minHeight: Tokens.minimumTouchTarget)
            }
        }
    }

    private var consents: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
            Text(L10n.string("consent.consentsTitle"))
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .accessibilityAddTraits(.isHeader)

            // Said once, at the top, rather than repeated under each: refusing
            // costs nothing, and somebody deciding needs to know that before
            // they read the first one.
            Text(L10n.string("consent.optionalNote"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            ForEach(ConsentType.askable, id: \.rawValue) { type in
                ConsentRow(
                    type: type,
                    active: state.active(type),
                    latest: state.latest(type),
                    isWorking: state.working == type
                ) { give in
                    await refresh {
                        if give { await model.give(type) } else { await model.withdraw(type) }
                    }
                }
            }

            Text(L10n.string("consent.forwardOnly"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
        }
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

struct ConsentRow: View {
    @Environment(\.colorScheme) private var scheme

    let type: ConsentType
    let active: Consent?
    let latest: Consent?
    let isWorking: Bool
    let onChange: (_ give: Bool) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(type.localizedName)
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            // What this permission is *not* about, which is the part people get
            // wrong: refusing photo promotion must not read as refusing to have
            // wound photographs taken at all.
            Text(type.explanation)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            HStack {
                Text(active == nil
                    ? L10n.string("consent.notGiven")
                    : L10n.string("consent.given"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(
                        (active == nil ? Tokens.Palette.textSecondary : Tokens.Palette.success)
                            .resolve(for: scheme)
                    )

                Spacer()

                if let active {
                    Button(L10n.string("consent.withdraw"), role: .destructive) {
                        Task { await onChange(false) }
                    }
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .accessibilityHint(active.signedAt.formatted(date: .abbreviated, time: .omitted))
                } else {
                    Button(L10n.string("consent.give")) { Task { await onChange(true) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(isWorking)
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }

            // The record is kept when a permission is withdrawn, and saying so
            // is the difference between "we forgot" and "we stopped".
            if active == nil, let latest, let revokedAt = latest.revokedAt {
                Text("\(L10n.string("consent.withdrawnAt")): \(revokedAt.formatted(date: .abbreviated, time: .omitted))")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .accessibilityElement(children: .contain)
    }
}

import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The check-up calendar (spec M6).
public struct FollowUpScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: FollowUpModel
    private let canMark: Bool

    @State private var state = FollowUpState()

    /// - Parameter canMark: staff mark a visit attended; a patient only reads.
    public init(model: FollowUpModel, canMark: Bool = false) {
        self.model = model
        self.canMark = canMark
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.refresh() } }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .none:
            MessageState(icon: "calendar", text: L10n.string("followUp.empty"))

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("error.notFound"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await refresh { await model.refresh() }
            }

        case .loaded:
            schedule
        }
    }

    private var schedule: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                // The next visit, first and large. It is what a patient opens
                // this screen to find, and a list they have to read to the
                // middle of is one they read wrong.
                if let next = state.next {
                    NextVisitCard(milestone: next)
                }

                if !state.missed.isEmpty {
                    Label(
                        "\(L10n.string("followUp.missedCount")): \(state.missed.count)",
                        systemImage: Tokens.State.triageUrgent.iconName
                    )
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                }

                if let error = state.error {
                    ErrorBanner(message: error)
                }

                ForEach(state.schedule?.milestones ?? []) { milestone in
                    MilestoneRow(
                        milestone: milestone,
                        canMark: canMark,
                        isWorking: state.working == milestone.id
                    ) { status in
                        await refresh { await model.mark(milestone.id, as: status) }
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

struct NextVisitCard: View {
    @Environment(\.colorScheme) private var scheme

    let milestone: Milestone

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(L10n.string("followUp.nextVisit"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Text(milestone.localizedLabel)
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            Text(milestone.dueAt, style: .date)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
        }
        .padding(Tokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Palette.infoSurface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityElement(children: .combine)
    }
}

struct MilestoneRow: View {
    @Environment(\.colorScheme) private var scheme

    let milestone: Milestone
    let canMark: Bool
    let isWorking: Bool
    let onMark: (MilestoneStatus) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(milestone.localizedLabel)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer()

                // State in words as well as colour, because a colour a reader
                // cannot distinguish says nothing (spec section 7).
                Text(milestone.status.localizedName)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(tint.resolve(for: scheme))
            }

            Text(milestone.dueAt, style: .date)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            if canMark && milestone.status.isOutstanding {
                HStack(spacing: Tokens.Spacing.md) {
                    Button(L10n.string("followUp.markAttended")) {
                        Task { await onMark(.completed) }
                    }
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)

                    Button(L10n.string("followUp.markSkipped")) {
                        Task { await onMark(.skipped) }
                    }
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var tint: ThemedColor {
        switch milestone.status {
        case .completed: return Tokens.Palette.success
        case .missed: return Tokens.Palette.warning
        case .skipped: return Tokens.Palette.textSecondary
        case .pending, .notified: return Tokens.Palette.info
        }
    }
}

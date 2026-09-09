import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

public enum InboxPhase: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

public struct InboxState: Sendable, Equatable {
    public var phase: InboxPhase = .loading
    public var entries: [InboxEntry] = []

    public init() {}

    /// Unanswered first, then most recent. A doctor working through an inbox is
    /// looking for what is waiting, not for what happened last.
    public var ordered: [InboxEntry] {
        entries.sorted { left, right in
            if (left.unread > 0) != (right.unread > 0) { return left.unread > 0 }

            let leftAt = left.conversation.lastMessageAt ?? .distantPast
            let rightAt = right.conversation.lastMessageAt ?? .distantPast

            return leftAt > rightAt
        }
    }

    public var totalUnread: Int { entries.reduce(0) { $0 + $1.unread } }
}

/// Every conversation the clinician can see (spec M3).
@MainActor
public final class InboxModel {
    private let api: MessagingAPI
    private var state = InboxState()

    public init(api: MessagingAPI) {
        self.api = api
    }

    public func currentState() -> InboxState { state }

    public func load() async {
        do {
            state.entries = try await api.inbox()
            state.phase = state.entries.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }
}

/**
 * The clinician's inbox.
 *
 * Conversations across every patient they can see, unanswered first. Until this
 * existed a doctor could only reach a conversation by remembering which patient
 * it belonged to and opening their file — which works right up until somebody
 * writes at nine at night about a wound.
 */
public struct InboxScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: InboxModel
    private let openConversation: (String, String) -> Void

    @State private var state = InboxState()

    public init(model: InboxModel, openConversation: @escaping (String, String) -> Void) {
        self.model = model
        self.openConversation = openConversation
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 2)
                        SkeletonCard(lines: 2)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .empty:
                    MessageState(
                        icon: "bubble.left.and.bubble.right",
                        text: L10n.string("inbox.empty")
                    )
                    .frame(minHeight: 280)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    ForEach(state.ordered) { entry in
                        row(entry)
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("inbox.title"))
        .refreshable { await reload() }
        .task { await reload() }
    }

    private func row(_ entry: InboxEntry) -> some View {
        Button {
            openConversation(entry.patient.id, entry.patient.fullName)
        } label: {
            Card(tone: entry.unread > 0 ? .info : .neutral) {
                HStack(spacing: Tokens.Spacing.md) {
                    InitialsAvatar(name: entry.patient.fullName, diameter: 44)

                    VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                        HStack(spacing: Tokens.Spacing.sm) {
                            Text(entry.patient.fullName)
                                .font(Tokens.Typography.subheadingRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textPrimary.resolve(for: scheme)
                                )

                            Spacer(minLength: Tokens.Spacing.sm)

                            if let at = entry.conversation.lastMessageAt {
                                Text(at.formatted(date: .abbreviated, time: .shortened))
                                    .font(Tokens.Typography.captionRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textSecondary.resolve(for: scheme)
                                    )
                            }
                        }

                        Text(entry.preview)
                            .font(Tokens.Typography.calloutRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }

                    if entry.unread > 0 {
                        Badge("\(entry.unread)", tone: .info, symbol: "envelope.badge")
                    }
                }
                .frame(minHeight: Tokens.minimumTouchTarget)
                .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

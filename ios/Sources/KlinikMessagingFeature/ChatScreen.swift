import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// One conversation (spec M3).
public struct ChatScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ChatModel
    private let canUseTemplates: Bool
    private let onTyping: (@Sendable (String) -> Void)?

    @State private var state = ChatState()
    @State private var draft = ""
    @State private var showingTemplates = false

    /// - Parameter onTyping: notifies the socket. Supplied by the caller so the
    ///   screen owns no connection of its own.
    public init(
        model: ChatModel,
        canUseTemplates: Bool = false,
        onTyping: (@Sendable (String) -> Void)? = nil
    ) {
        self.model = model
        self.canUseTemplates = canUseTemplates
        self.onTyping = onTyping
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task {
            await refresh { await model.load() }
            await refresh { await model.markRead() }
            if canUseTemplates { await refresh { await model.loadQuickReplies() } }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

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

        case .empty, .loaded:
            conversation
        }
    }

    private var conversation: some View {
        VStack(spacing: 0) {
            // Above everything, before a word is typed. Telling someone their
            // message was held only after they sent it is how "queued" comes to
            // feel like "lost".
            if state.willBeQueued {
                ClosedBanner(opensAt: state.clinic?.opensAt)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    if state.hasOlder {
                        Button(L10n.string("message.loadOlder")) {
                            Task { await refresh { await model.loadOlder() } }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: Tokens.minimumTouchTarget)
                    }

                    ForEach(state.messages) { message in
                        MessageRow(message: message)
                    }

                    if !state.typing.isEmpty {
                        Text(L10n.string("message.typing"))
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }
                }
                .padding(Tokens.Spacing.lg)
            }

            if let error = state.error {
                ErrorBanner(message: error).padding(.horizontal, Tokens.Spacing.lg)
            }

            composer
        }
        .sheet(isPresented: $showingTemplates) {
            QuickReplyList(replies: state.quickReplies) { reply in
                draft = reply.body
                showingTemplates = false
            }
        }
    }

    private var composer: some View {
        VStack(spacing: Tokens.Spacing.sm) {
            if canUseTemplates && !state.quickReplies.isEmpty {
                Button(L10n.string("message.templates")) { showingTemplates = true }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: Tokens.minimumTouchTarget)
            }

            LabelledField(
                label: L10n.string("message.compose"),
                text: $draft,
                isSecure: false,
                contentType: .plain,
                keyboard: .default
            )
            .onChange(of: draft) { _, _ in
                if let conversationId = state.conversationId {
                    onTyping?(conversationId)
                }
            }

            PrimaryButton(
                title: L10n.string("common.send"),
                isBusy: state.sending,
                isEnabled: !draft.trimmingCharacters(in: .whitespaces).isEmpty && !state.sending
            ) {
                let text = draft
                let sent = await refreshReturning { await model.send(text) }
                if sent { draft = "" }
            }
        }
        .padding(Tokens.Spacing.lg)
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

/// Said before anything is typed, and in words: the clinic is closed and this
/// is when it opens.
struct ClosedBanner: View {
    @Environment(\.colorScheme) private var scheme

    let opensAt: Date?

    var body: some View {
        HStack(spacing: Tokens.Spacing.sm) {
            Image(systemName: "clock")

            Text(text)
                .font(Tokens.Typography.calloutRelative)
        }
        .foregroundStyle(Tokens.Palette.info.resolve(for: scheme))
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Palette.infoSurface.resolve(for: scheme))
        .accessibilityElement(children: .combine)
    }

    private var text: String {
        guard let opensAt else { return L10n.string("message.clinicClosed") }

        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short

        return "\(L10n.string("message.queuedUntil")) \(formatter.string(from: opensAt))"
    }
}

struct MessageRow: View {
    @Environment(\.colorScheme) private var scheme

    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
            Text(message.body ?? message.transcript ?? L10n.string("message.attachment"))
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            HStack(spacing: Tokens.Spacing.sm) {
                Text(message.createdAt, style: .time)
                    .font(Tokens.Typography.footnoteRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                // Status in words rather than ticks: a tick a reader cannot
                // interpret says nothing (spec section 7).
                Text(message.status.localizedName)
                    .font(Tokens.Typography.footnoteRelative)
                    .foregroundStyle(
                        (message.isQueued ? Tokens.Palette.info : Tokens.Palette.textSecondary)
                            .resolve(for: scheme)
                    )
            }
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Palette.surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityElement(children: .combine)
    }
}

struct QuickReplyList: View {
    @Environment(\.colorScheme) private var scheme

    let replies: [QuickReply]
    let onPick: (QuickReply) -> Void

    var body: some View {
        List(replies) { reply in
            Button {
                onPick(reply)
            } label: {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text(reply.title)
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    Text(reply.body)
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            }
            .frame(minHeight: Tokens.minimumTouchTarget)
        }
        .listStyle(.plain)
    }
}

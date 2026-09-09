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
    /// Set on the patient's side only. Staff have no assistant to hand off to.
    private let openAssistant: (() -> Void)?
    /// Supplied by the app shell, which owns the picker. Nil hides the button
    /// rather than showing one that does nothing.
    private let pickAttachment: (() async -> (url: URL, contentType: String)?)?

    @State private var state = ChatState()
    @State private var draft = ""
    @State private var showingTemplates = false
    @State private var attaching = false
    @State private var viewing: ViewedAttachment?

    /// - Parameter onTyping: notifies the socket. Supplied by the caller so the
    ///   screen owns no connection of its own.
    public init(
        model: ChatModel,
        canUseTemplates: Bool = false,
        onTyping: (@Sendable (String) -> Void)? = nil,
        openAssistant: (() -> Void)? = nil,
        pickAttachment: (() async -> (url: URL, contentType: String)?)? = nil
    ) {
        self.model = model
        self.canUseTemplates = canUseTemplates
        self.onTyping = onTyping
        self.openAssistant = openAssistant
        self.pickAttachment = pickAttachment
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

            // Offered, never forced. The spec puts the assistant in front of
            // the clinic (M4), but a patient who wants a person should not
            // have to argue with a machine first — especially outside hours,
            // which is exactly when the assistant is worth trying.
            if let openAssistant {
                AssistantOffer(isClinicClosed: state.willBeQueued, open: openAssistant)
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
                        if message.hasAttachment {
                            Button { Task { await open(message) } } label: {
                                MessageRow(message: message)
                            }
                            .buttonStyle(.plain)
                            .frame(minHeight: Tokens.minimumTouchTarget)
                        } else {
                            MessageRow(message: message)
                        }
                    }

                    // After everything the clinic has, because that is where
                    // they were written. Marked, because the clinic has not
                    // seen them.
                    ForEach(state.unsent) { message in
                        UnsentMessageRow(message: message)
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
        .sheet(item: $viewing) { attachment in
            AttachmentViewer(url: attachment.url)
        }
    }

    private var composer: some View {
        VStack(spacing: Tokens.Spacing.sm) {
            HStack(spacing: Tokens.Spacing.md) {
                if canUseTemplates && !state.quickReplies.isEmpty {
                    Button(L10n.string("message.templates")) { showingTemplates = true }
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }

                if pickAttachment != nil {
                    Button {
                        Task { await attach() }
                    } label: {
                        Label(L10n.string("message.attach"), systemImage: "paperclip")
                            .font(Tokens.Typography.calloutRelative)
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .disabled(attaching || state.sending)
                }

                Spacer(minLength: 0)

                if attaching {
                    ProgressView().accessibilityLabel(L10n.string("message.attaching"))
                }
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

    /// Picks a file, uploads it and sends it with whatever is in the box.
    private func attach() async {
        guard let pickAttachment, let picked = await pickAttachment() else { return }

        attaching = true
        defer { attaching = false }

        let caption = draft
        let sent = await refreshReturning {
            await model.attach(
                fileURL: picked.url,
                contentType: picked.contentType,
                caption: caption
            )
        }

        if sent { draft = "" }
    }

    /// Fetches the signed link when somebody taps, not before: the link is
    /// short-lived, and one fetched with the list would be dead by the time a
    /// reader scrolled to it.
    private func open(_ message: ChatMessage) async {
        guard message.hasAttachment else { return }
        guard let url = await model.attachmentURL(for: message.id) else {
            state = await model.currentState()
            return
        }

        viewing = ViewedAttachment(id: message.id, url: url)
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
                // The text beside it already says when the clinic reopens.
                .accessibilityHidden(true)

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

/**
 * A message this phone is still holding.
 *
 * Drawn deliberately unlike a delivered one: no delivery state, no sender,
 * and a badge saying it has not been sent. The alternative — rendering it as
 * an ordinary message with a small grey clock — is how somebody comes to
 * believe the clinic has read a symptom nobody has seen.
 */
struct UnsentMessageRow: View {
    @Environment(\.colorScheme) private var scheme

    let message: UnsentMessage

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(message.body)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            HStack(spacing: Tokens.Spacing.sm) {
                Text(message.writtenAt, style: .time)
                    .font(Tokens.Typography.footnoteRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                Badge(
                    L10n.string("sync.queuedBadge"),
                    tone: .warning,
                    symbol: "clock.arrow.circlepath"
                )
            }
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tone.warning.surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(message.body). \(L10n.string("sync.queuedBadge"))")
    }
}

struct MessageRow: View {
    @Environment(\.colorScheme) private var scheme

    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            if message.hasAttachment {
                // Says what it is and that it opens. "Ek" on its own reads as a
                // message the app failed to render.
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: message.type == .image ? "photo" : "paperclip")
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                        .accessibilityHidden(true)

                    Text(
                        L10n.string(
                            message.type == .image ? "message.photoAttached" : "message.fileAttached"
                        )
                    )
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                    Spacer(minLength: 0)
                }
            }

            if let text = message.body ?? message.transcript, !text.isEmpty {
                Text(text)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
            }

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


/**
 * The way into the FAQ assistant, from the conversation.
 *
 * A row rather than a redirect: the spec has the assistant answer first, and
 * making it a wall would mean a patient with a real worry has to get past a bot
 * to reach a nurse. The offer is louder when the clinic is closed, because that
 * is when it is genuinely the faster answer.
 */
struct AssistantOffer: View {
    @Environment(\.colorScheme) private var scheme

    let isClinicClosed: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: Tokens.Spacing.md) {
                Image(systemName: "text.bubble")
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.info.resolve(for: scheme))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text(L10n.string("assistant.title"))
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    Text(
                        L10n.string(
                            isClinicClosed ? "assistant.offerClosed" : "assistant.offerOpen"
                        )
                    )
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: Tokens.Spacing.sm)

                Image(systemName: "chevron.right")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                    .accessibilityHidden(true)
            }
            .padding(Tokens.Spacing.md)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .background(Tokens.Palette.infoSurface.resolve(for: scheme))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}


/// What the attachment sheet carries. A URL is not `Identifiable`, and the
/// sheet needs an identity to know when to re-present.
struct ViewedAttachment: Identifiable, Equatable {
    let id: String
    let url: URL
}

#if os(iOS)
import QuickLook

/// The same previewer the documents screen uses, so a photograph sent in a
/// message and one uploaded to the file open the same way.
struct AttachmentViewer: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator

        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.url = url
        controller.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL

        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            url as NSURL
        }
    }
}
#else
/// The package builds for macOS so its tests run headlessly; no test opens an
/// attachment.
struct AttachmentViewer: View {
    let url: URL

    var body: some View {
        Text(url.lastPathComponent)
    }
}
#endif

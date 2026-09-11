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
    /// The live half, supplied by the shell because a connection belongs to
    /// the session rather than to a screen. Nil in previews and tests, where
    /// the thread simply does not update on its own.
    private let live: (any LiveChannel)?
    /// Recording a voice message (spec M3). Nil leaves the button out rather
    /// than showing one that cannot work.
    private let voice: VoiceRecording?
    /**
     * Bumped whenever the offline queue actually delivered something.
     *
     * Rows the app is holding are drawn from the queue, and nothing told this
     * screen when the queue emptied — so a reading or a message sent minutes
     * ago kept its "not sent yet" badge until the reader navigated away and
     * back.
     */
    private let queueRevision: Int

    @State private var state = ChatState()
    @State private var draft = ""
    @State private var showingTemplates = false
    @State private var attaching = false
    @State private var viewing: ViewedAttachment?
    @State private var recording = false
    @State private var recordedFor = 0
    @State private var microphoneRefused = false
    /// False until the first load has been placed at the bottom, so that jump
    /// is instant and everything after it animates.
    @State private var hasSettled = false
    /// When the socket was last told somebody is writing. See `announceTyping`.
    @State private var lastTypingSentAt = Date.distantPast

    /**
     * The language to translate into.
     *
     * The reader's own, taken from the device rather than from the clinic: a
     * German patient reading a Turkish reply and a Turkish clinician reading a
     * German complaint press the same button and mean two different things.
     */
    private var readerLanguage: String {
        Locale.current.language.languageCode?.identifier ?? "tr"
    }

    /// - Parameter onTyping: notifies the socket. Kept as a separate closure
    ///   from `live` because the assistant screen reuses this view with no
    ///   connection at all, and a nil channel there must not mean a nil typing
    ///   indicator somewhere else.
    public init(
        model: ChatModel,
        canUseTemplates: Bool = false,
        live: (any LiveChannel)? = nil,
        onTyping: (@Sendable (String) -> Void)? = nil,
        openAssistant: (() -> Void)? = nil,
        pickAttachment: (() async -> (url: URL, contentType: String)?)? = nil,
        voice: VoiceRecording? = nil,
        queueRevision: Int = 0
    ) {
        self.model = model
        self.canUseTemplates = canUseTemplates
        self.onTyping = onTyping
        self.openAssistant = openAssistant
        self.pickAttachment = pickAttachment
        self.live = live
        self.voice = voice
        self.queueRevision = queueRevision
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

            // After the load, because joining needs the conversation id the
            // load resolves — a patient's thread is found by who they are, not
            // named by the caller.
            await listen()
        }
        .navigationTitle(L10n.string("menu.messages"))
        .onChange(of: queueRevision) { _, _ in
            Task { await refresh { await model.load() } }
        }
        .onDisappear {
            // A recording in progress belongs to a screen that no longer
            // exists. Left running it holds the microphone and the audio
            // session open for as long as the app is up.
            if recording {
                voice?.cancel()
                recording = false
                recordedFor = 0
            }

            guard let conversationId = state.conversationId else { return }

            live?.leave(conversationId)
            live?.unsubscribe(conversationId)
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

            ScrollViewReader { scroller in
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
                        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                            if message.hasAttachment {
                                Button { Task { await open(message) } } label: {
                                    MessageRow(
                                        message: message,
                                        showingOriginal: state.showingOriginal.contains(message.id)
                                    )
                                }
                                .buttonStyle(.plain)
                                .frame(minHeight: Tokens.minimumTouchTarget)
                            } else {
                                MessageRow(
                                    message: message,
                                    showingOriginal: state.showingOriginal.contains(message.id)
                                )
                            }

                            TranslateAction(
                                message: message,
                                isWorking: state.translating == message.id,
                                showingOriginal: state.showingOriginal.contains(message.id),
                                translate: {
                                    await refresh {
                                        await model.translate(message.id, into: readerLanguage)
                                    }
                                },
                                toggleOriginal: { showing in
                                    await refresh { await model.showOriginal(message.id, showing) }
                                }
                            )
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

                    // What everything scrolls to. An anchor of its own rather
                    // than the last row, because "the bottom" has to keep
                    // meaning the bottom when the last row is an unsent message
                    // or the typing line.
                    Color.clear
                        .frame(height: 1)
                        .id(ChatScreen.bottomAnchor)
                        .accessibilityHidden(true)
                }
                .padding(Tokens.Spacing.lg)
                }
                /*
                 * A conversation opens at its newest message.
                 *
                 * Without this the thread opened at the oldest message it had
                 * loaded — months back, for a patient in follow-up — and stayed
                 * there when the clinic answered. Every chat anybody has ever
                 * used does this; a thread that does not reads as broken.
                 *
                 * Not animated on the first pass: sliding through a year of
                 * history on open is a long way to travel to arrive where the
                 * screen should have started.
                 */
                .onChange(of: state.messages.last?.id) { _, _ in
                    // The last id, not the count: "load older" prepends, and
                    // scrolling to the bottom for that would undo the tap.
                    scrollToBottom(scroller, animated: hasSettled)
                }
                .onChange(of: state.unsent.count) { _, _ in
                    scrollToBottom(scroller, animated: hasSettled)
                }
                .task(id: state.phase) {
                    guard case .loaded = state.phase else { return }

                    scrollToBottom(scroller, animated: false)
                    hasSettled = true
                }
            }

            if let error = state.error {
                ErrorBanner(message: error).padding(.horizontal, Tokens.Spacing.lg)
            }

            composer
        }
        .sheet(isPresented: $showingTemplates) {
            QuickReplyList(
                replies: state.quickReplies,
                onPick: { reply in
                    draft = reply.body
                    showingTemplates = false
                },
                onSave: { title, body in
                    let saved = await model.saveQuickReply(title: title, body: body)
                    state = await model.currentState()

                    return saved
                },
                onDelete: { id in
                    await model.removeQuickReply(id: id)
                    state = await model.currentState()
                }
            )
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

                if let voice, voice.isAvailable {
                    Button {
                        Task { await toggleRecording(voice) }
                    } label: {
                        Label(
                            L10n.string(recording ? "message.stopRecording" : "message.record"),
                            systemImage: recording ? "stop.circle.fill" : "mic"
                        )
                        .font(Tokens.Typography.calloutRelative)
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .disabled(attaching || state.sending)
                    .foregroundStyle(
                        (recording ? Tone.critical.foreground : Tokens.Palette.accent)
                            .resolve(for: scheme)
                    )
                }

                Spacer(minLength: 0)

                if attaching {
                    ProgressView().accessibilityLabel(L10n.string("message.attaching"))
                }
            }

            if recording, let voice {
                RecordingBar(
                    seconds: recordedFor,
                    cancel: {
                        voice.cancel()
                        recording = false
                        recordedFor = 0
                    }
                )
            }

            if microphoneRefused {
                Text(L10n.string("message.microphoneRefused"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tone.warning.foreground.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }

            LabelledField(
                label: L10n.string("message.compose"),
                text: $draft,
                isSecure: false,
                contentType: .plain,
                keyboard: .default
            )
            .onChange(of: draft) { _, _ in
                announceTyping()
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
        defer {
            attaching = false
            // The picker's copy. The upload has the bytes; what is left here is
            // somebody's document sitting in the temporary directory, and the
            // voice path next door already cleans up after itself.
            try? FileManager.default.removeItem(at: picked.url)
        }

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

    /**
     * Tells the room somebody is writing, at most once every few seconds.
     *
     * The indicator means "this person is composing", which is true for as long
     * as they keep typing — so it does not need to be said again for every
     * character. Unthrottled, a two-hundred character message was two hundred
     * socket frames.
     */
    private func announceTyping() {
        guard let conversationId = state.conversationId else { return }

        let now = Date()
        guard now.timeIntervalSince(lastTypingSentAt) >= ChatScreen.typingInterval else { return }

        lastTypingSentAt = now
        onTyping?(conversationId)
    }

    /// Comfortably shorter than the indicator's own life on the other side, so
    /// it never lapses while somebody is still writing.
    nonisolated static let typingInterval: TimeInterval = 3

    /// The id of the marker at the very bottom of the thread.
    fileprivate static let bottomAnchor = "chat.bottom"

    private func scrollToBottom(_ scroller: ScrollViewProxy, animated: Bool) {
        guard animated else {
            scroller.scrollTo(ChatScreen.bottomAnchor, anchor: .bottom)
            return
        }

        withAnimation { scroller.scrollTo(ChatScreen.bottomAnchor, anchor: .bottom) }
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
    /// The reader asked to see what the sender actually wrote.
    var showingOriginal = false

    private var original: String? { message.body ?? message.transcript }

    /// The translation when there is one and the reader has not asked for the
    /// original. The original is never thrown away — it is one tap behind.
    private var shown: String? {
        guard let translated = message.translatedText, !showingOriginal else { return original }

        return translated
    }

    private var isTranslated: Bool { message.translatedText != nil && !showingOriginal }

    /// A voice message shown as "dosya" is one a clinician has to guess at
    /// before opening. `nonisolated` because a static on a `View` otherwise
    /// inherits the view's main-actor isolation.
    nonisolated static func symbol(for type: MessageType) -> String {
        switch type {
        case .image: return "photo"
        case .audio: return "waveform"
        default: return "paperclip"
        }
    }

    nonisolated static func attachmentKey(for type: MessageType) -> String {
        switch type {
        case .image: return "message.photoAttached"
        case .audio: return "message.audioAttached"
        default: return "message.fileAttached"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            if message.hasAttachment {
                // Says what it is and that it opens. "Ek" on its own reads as a
                // message the app failed to render.
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: MessageRow.symbol(for: message.type))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                        .accessibilityHidden(true)

                    Text(L10n.string(MessageRow.attachmentKey(for: message.type)))
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                    Spacer(minLength: 0)
                }
            }

            if let text = shown, !text.isEmpty {
                Text(text)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
            }

            // Said, not implied. A translated message that looks exactly like
            // an original is one a clinician quotes back as the patient's own
            // words — and a model's reading of a complaint is not that.
            if isTranslated {
                Label(
                    L10n.string("message.translated"),
                    systemImage: "character.bubble"
                )
                .font(Tokens.Typography.footnoteRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
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
    /// Saves a new one. Returns true when the server took it.
    let onSave: (String, String) async -> Bool
    let onDelete: (String) async -> Void

    @State private var adding = false
    @State private var title = ""
    @State private var body_ = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(replies) { reply in
                    Button {
                        onPick(reply)
                    } label: {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                            HStack(spacing: Tokens.Spacing.sm) {
                                Text(reply.title)
                                    .font(Tokens.Typography.subheadingRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textPrimary.resolve(for: scheme)
                                    )

                                if reply.isShared {
                                    Badge(L10n.string("message.templateShared"))
                                }
                            }

                            Text(reply.body)
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )
                        }
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    // Only your own. A shared reply belongs to the clinic, and
                    // the server refuses to let one person retire everybody's.
                    .swipeActions(edge: .trailing) {
                        if !reply.isShared {
                            Button(L10n.string("common.delete"), role: .destructive) {
                                Task { await onDelete(reply.id) }
                            }
                        }
                    }
                }

                if adding {
                    Section(L10n.string("message.templateNew")) {
                        LabelledField(
                            label: L10n.string("message.templateTitle"),
                            text: $title,
                            isSecure: false,
                            contentType: .plain,
                            keyboard: .default
                        )

                        LabelledField(
                            label: L10n.string("message.templateBody"),
                            text: $body_,
                            isSecure: false,
                            contentType: .plain,
                            keyboard: .default
                        )

                        PrimaryButton(
                            title: L10n.string("common.save"),
                            isBusy: saving,
                            isEnabled: !title.trimmingCharacters(in: .whitespaces).isEmpty
                                && !body_.trimmingCharacters(in: .whitespaces).isEmpty
                                && !saving
                        ) {
                            saving = true

                            if await onSave(title, body_) {
                                title = ""
                                body_ = ""
                                adding = false
                            }

                            saving = false
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle(L10n.string("message.templates"))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(L10n.string(adding ? "common.cancel" : "message.templateAdd")) {
                        adding.toggle()
                    }
                }
            }
        }
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


/**
 * The translate button, and the way back to the original (spec M3).
 *
 * Offered on every message with words in it rather than only on ones that look
 * foreign: the app does not know what language a message is in until somebody
 * asks, and guessing wrong either hides the button from the person who needs
 * it or clutters a Turkish thread with an offer to translate Turkish into
 * Turkish. Once a message is translated the row switches to the way back.
 */
struct TranslateAction: View {
    @Environment(\.colorScheme) private var scheme

    let message: ChatMessage
    let isWorking: Bool
    let showingOriginal: Bool
    let translate: () async -> Void
    let toggleOriginal: (Bool) async -> Void

    var body: some View {
        if !message.hasText {
            EmptyView()
        } else if message.translatedText != nil {
            Button {
                Task { await toggleOriginal(!showingOriginal) }
            } label: {
                Text(
                    L10n.string(
                        showingOriginal ? "message.showTranslation" : "message.showOriginal"
                    )
                )
                .font(Tokens.Typography.footnoteRelative)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            .frame(minHeight: Tokens.minimumTouchTarget, alignment: .leading)
        } else {
            Button {
                Task { await translate() }
            } label: {
                if isWorking {
                    // The word beside it says what is happening.
                    ProgressView()
                        .accessibilityHidden(true)
                } else {
                    Text(L10n.string("message.translate"))
                        .font(Tokens.Typography.footnoteRelative)
                }
            }
            .buttonStyle(.plain)
            .disabled(isWorking)
            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            .frame(minHeight: Tokens.minimumTouchTarget, alignment: .leading)
        }
    }
}


extension ChatScreen {
    /**
     * Joins the room and routes what arrives into the model.
     *
     * A message the caller sent themselves arrives twice — once from the POST
     * and once over the socket — and `ChatModel.append` replaces by id rather
     * than appending, which is what keeps the thread from showing both.
     */
    @MainActor
    fileprivate func listen() async {
        guard let live, let conversationId = state.conversationId else { return }

        live.subscribe(conversationId) { event in
            Task { @MainActor in
                switch event {
                case .message(let message):
                    await model.receive(message)
                    // A message arriving while the thread is open has been
                    // read by definition: the person is looking at it.
                    await model.markRead()

                case .typing(_, let userId):
                    await model.setTyping(userId, isTyping: true)

                case .read:
                    // Nothing to change on this side yet: the ticks a reader
                    // sees are their own, and the sender's screen reloads.
                    break
                }

                state = await model.currentState()
            }
        }

        live.join(conversationId)
    }
}


extension ChatScreen {
    /**
     * Starts or finishes a recording.
     *
     * Tap to start, tap to stop — not press-and-hold. Somebody three days
     * after an operation may be holding the phone in one hand, and a gesture
     * that loses the message when a finger slips is a gesture that loses
     * messages.
     */
    @MainActor
    fileprivate func toggleRecording(_ voice: VoiceRecording) async {
        if recording {
            recording = false

            guard let recorded = await voice.stop() else {
                // Under a second: a tap that started and stopped. Sending it
                // would give the clinician silence to wonder about.
                recordedFor = 0
                return
            }

            recordedFor = 0
            attaching = true
            defer { attaching = false }

            await refresh {
                await model.attach(fileURL: recorded.url, contentType: recorded.contentType)
            }

            // The upload has the bytes now; a copy in the temporary directory
            // is somebody's voice left on the phone for no reason.
            try? FileManager.default.removeItem(at: recorded.url)

            return
        }

        microphoneRefused = false

        guard await voice.start() else {
            // Not a failure to apologise for: the person said no.
            microphoneRefused = true
            return
        }

        recording = true
        recordedFor = 0

        await tick(voice)
    }

    /// Counts while recording, and stops the recording at the ceiling rather
    /// than letting a pocket recording run to three minutes of nothing.
    @MainActor
    fileprivate func tick(_ voice: VoiceRecording) async {
        while recording {
            try? await Task.sleep(for: .seconds(1))

            guard recording else { return }

            recordedFor += 1

            if recordedFor >= Int(ChatScreen.maximumRecordingSeconds) {
                await toggleRecording(voice)
                return
            }
        }
    }

    /// Matches the recorder's own ceiling. `nonisolated` because a static on a
    /// `View` otherwise inherits the view's main-actor isolation.
    nonisolated static var maximumRecordingSeconds: TimeInterval { 180 }

    /// mm:ss. A bare number of seconds reads as a countdown at 90.
    nonisolated static func elapsed(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// What is happening while the microphone is open.
struct RecordingBar: View {
    @Environment(\.colorScheme) private var scheme

    let seconds: Int
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: Tokens.Spacing.sm) {
            Image(systemName: "waveform")
                .font(Tokens.Typography.bodyRelative)
                // The words beside it say the same thing.
                .accessibilityHidden(true)

            Text(L10n.string("message.recording"))
                .font(Tokens.Typography.captionRelative)

            Text(ChatScreen.elapsed(seconds))
                .font(Tokens.Typography.captionRelative)
                .monospacedDigit()

            Spacer(minLength: 0)

            Button(L10n.string("common.cancel"), role: .destructive, action: cancel)
                .font(Tokens.Typography.captionRelative)
                .frame(minHeight: Tokens.minimumTouchTarget)
        }
        .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
        .padding(.horizontal, Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tone.critical.surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

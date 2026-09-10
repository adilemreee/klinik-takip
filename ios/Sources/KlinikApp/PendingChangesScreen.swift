import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign
import KlinikSync

/**
 * What the app is holding and has not delivered (spec M15).
 *
 * The screen exists because the queue is otherwise invisible, and an invisible
 * queue is indistinguishable from lost work. Everything a person can be told
 * about their own unsent writes is here: what it was, when they made it, how
 * many times it has been tried, and what the clinic said the last time.
 *
 * Two things are deliberately hard to do by accident and easy to do on
 * purpose: sending again, and giving up on something. Nothing on this screen
 * discards anything on its own.
 */
@MainActor
struct PendingChangesScreen: View {
    @Environment(\.colorScheme) private var scheme

    let sync: SyncCoordinator

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                if sync.storeFailure != nil {
                    storeFailed
                }

                summary

                if !sync.conflicts.isEmpty {
                    conflicts
                }

                if !sync.stuck.isEmpty {
                    stuck
                }

                if !sync.stuckUploads.isEmpty {
                    stuckFiles
                }

                if !sync.waiting.isEmpty {
                    waiting
                }

                if !sync.waitingUploads.isEmpty {
                    waitingFiles
                }

                if !sync.isHoldingSomething {
                    empty
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .navigationTitle(L10n.string("sync.title"))
        .task { await sync.refresh() }
        .refreshable { await sync.sync() }
    }

    // MARK: - The state of the queue

    private var summary: some View {
        Card(tone: summaryTone) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: summaryTone.iconName)
                        .font(Tokens.Typography.headingRelative)
                        .foregroundStyle(summaryTone.foreground.resolve(for: scheme))
                        // The sentence beside it says the same thing.
                        .accessibilityHidden(true)

                    Text(summaryTitle)
                        .font(Tokens.Typography.headingRelative)
                        .fixedSize(horizontal: false, vertical: true)

                    Spacer(minLength: 0)
                }

                if let lastSyncedAt = sync.lastSyncedAt {
                    Text(String(format: L10n.string("sync.lastSynced"), Moment.text(lastSyncedAt)))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                if sync.isHoldingSomething {
                    Button {
                        Task { await sync.sync() }
                    } label: {
                        HStack(spacing: Tokens.Spacing.sm) {
                            if sync.isSyncing {
                                // Hidden: the button's own words say
                                // "Gönderiliyor", and announcing it twice
                                // reads as a stutter.
                                ProgressView()
                                    .accessibilityHidden(true)
                            }

                            Text(
                                L10n.string(sync.isSyncing ? "sync.sending" : "sync.sendNow")
                            )
                        }
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sync.isSyncing)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    /**
     * The queue could not be opened.
     *
     * Said out loud because the consequence is specific and invisible: writes
     * made without a connection are held in memory and die with the app, which
     * is the one thing the queue exists to prevent.
     */
    private var storeFailed: some View {
        Card(tone: .critical) {
            HStack(spacing: Tokens.Spacing.sm) {
                Image(systemName: Tone.critical.iconName)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
                    // The sentence beside it says the same thing.
                    .accessibilityHidden(true)

                Text(L10n.string("sync.storeFailed"))
                    .font(Tokens.Typography.bodyRelative)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var summaryTone: Tone {
        if sync.needsAttention { return .critical }
        if !sync.isHoldingSomething { return .success }

        return .warning
    }

    private var summaryTitle: String {
        if sync.needsAttention { return L10n.string("sync.needsAttention") }
        if !sync.isHoldingSomething { return L10n.string("sync.upToDate") }
        if sync.heldCount == 1 { return L10n.string("sync.pendingOne") }

        return String(format: L10n.string("sync.pendingCount"), sync.heldCount)
    }

    // MARK: - Sections

    private var waiting: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("sync.waiting"))

            ForEach(sync.waiting) { entry in
                EntryCard(entry: entry, tone: .info, sync: sync)
            }
        }
    }

    private var stuck: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("sync.stuck"),
                subtitle: L10n.string("sync.stuckDetail")
            )

            ForEach(sync.stuck) { entry in
                EntryCard(entry: entry, tone: .critical, sync: sync)
            }
        }
    }

    private var waitingFiles: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("upload.waiting"))

            ForEach(sync.waitingUploads) { upload in
                UploadCard(upload: upload, tone: .info, sync: sync)
            }
        }
    }

    private var stuckFiles: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("sync.stuck"),
                subtitle: L10n.string("sync.stuckDetail")
            )

            ForEach(sync.stuckUploads) { upload in
                UploadCard(upload: upload, tone: .critical, sync: sync)
            }
        }
    }

    private var conflicts: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("sync.conflictTitle"),
                subtitle: L10n.string("sync.conflictDetail")
            )

            ForEach(sync.conflicts) { conflict in
                ConflictCard(conflict: conflict, sync: sync)
            }
        }
    }

    private var empty: some View {
        Card(tone: .success) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                Text(L10n.string("sync.empty"))
                    .font(Tokens.Typography.bodyRelative)

                Text(L10n.string("sync.emptyDetail"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// One queued write.
@MainActor
private struct EntryCard: View {
    @Environment(\.colorScheme) private var scheme
    @State private var confirmingDiscard = false

    let entry: OutboxEntry
    let tone: Tone
    let sync: SyncCoordinator

    var body: some View {
        Card(tone: tone) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                Text(entry.summary)
                    .font(Tokens.Typography.bodyRelative)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: Tokens.Spacing.sm) {
                    Text(Moment.text(entry.createdAt))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    if entry.attempts > 0 {
                        Badge(
                            String(format: L10n.string("sync.attempts"), entry.attempts),
                            tone: tone
                        )
                    }
                }

                // The clinic's own words. A generic "gönderilemedi" would hide
                // the one thing that says whether this is worth trying again.
                if let lastError = entry.lastError {
                    Text(String(format: L10n.string("sync.lastError"), lastError))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(tone.foreground.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button(role: .destructive) {
                    confirmingDiscard = true
                } label: {
                    Text(L10n.string("sync.discard"))
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }
        }
        .confirmationDialog(
            L10n.string("sync.discardTitle"),
            isPresented: $confirmingDiscard,
            titleVisibility: .visible
        ) {
            Button(L10n.string("sync.discard"), role: .destructive) {
                Task { await sync.discard(id: entry.id) }
            }
            Button(L10n.string("common.cancel"), role: .cancel) {}
        } message: {
            Text(L10n.string("sync.discardDetail"))
        }
    }
}

/**
 * One file waiting to be sent.
 *
 * Shows how far it got, because on a 20 MB scan that number is the difference
 * between "nearly there" and "nothing has happened" — and a patient deciding
 * whether to find better wifi needs to know which.
 */
@MainActor
private struct UploadCard: View {
    @Environment(\.colorScheme) private var scheme
    @State private var confirmingDiscard = false

    let upload: PendingUpload
    let tone: Tone
    let sync: SyncCoordinator

    var body: some View {
        Card(tone: tone) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                Text(upload.originalName)
                    .font(Tokens.Typography.bodyRelative)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: Tokens.Spacing.sm) {
                    Text(Moment.text(upload.startedAt))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    Text(UploadCard.size(upload.totalBytes))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    if upload.attempts > 0 {
                        Badge(
                            String(format: L10n.string("sync.attempts"), upload.attempts),
                            tone: tone
                        )
                    }
                }

                if !upload.fileExists {
                    Text(L10n.string("upload.fileGone"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                } else if let lastError = upload.lastError {
                    Text(String(format: L10n.string("sync.lastError"), lastError))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(tone.foreground.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button(role: .destructive) {
                    confirmingDiscard = true
                } label: {
                    Text(L10n.string("sync.discard"))
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }
        }
        .confirmationDialog(
            L10n.string("sync.discardTitle"),
            isPresented: $confirmingDiscard,
            titleVisibility: .visible
        ) {
            Button(L10n.string("sync.discard"), role: .destructive) {
                Task { await sync.discardUpload(id: upload.id) }
            }
            Button(L10n.string("common.cancel"), role: .cancel) {}
        } message: {
            Text(L10n.string("sync.discardDetail"))
        }
    }

    /// `nonisolated` because a static on a `View` otherwise inherits the
    /// view's main-actor isolation, and the tests call this directly.
    nonisolated static func size(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file

        return formatter.string(fromByteCount: Int64(bytes))
    }
}

/// A change the clinic refused because the record moved on under it.
@MainActor
private struct ConflictCard: View {
    @Environment(\.colorScheme) private var scheme

    let conflict: SyncConflict
    let sync: SyncCoordinator

    var body: some View {
        Card(tone: .critical) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                Text(conflict.summary)
                    .font(Tokens.Typography.bodyRelative)
                    .fixedSize(horizontal: false, vertical: true)

                Text(Moment.text(conflict.detectedAt))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                HStack(spacing: Tokens.Spacing.md) {
                    Button {
                        Task { await sync.resendMine(conflict) }
                    } label: {
                        Text(L10n.string("sync.keepMine"))
                            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    }
                    .buttonStyle(.borderedProminent)

                    Button(role: .destructive) {
                        Task { await sync.keepTheirs(conflict) }
                    } label: {
                        Text(L10n.string("sync.keepServer"))
                            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    }
                }
            }
        }
    }
}

/// "14:20" for today, a date for anything older — a bare time on a three-day-old
/// entry reads as three minutes ago.
///
/// `nonisolated` because the tests call it directly, and a static on a `View`
/// otherwise inherits the view's main-actor isolation.
enum Moment {
    nonisolated static func text(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()

        if calendar.isDate(date, inSameDayAs: now) {
            formatter.dateStyle = .none
            formatter.timeStyle = .short
        } else {
            formatter.dateStyle = .short
            formatter.timeStyle = .short
        }

        return formatter.string(from: date)
    }
}

/**
 * The bar that says the app is holding something.
 *
 * Shown only when there is something to say. It names a number rather than a
 * state — "3 kayıt gönderilmeyi bekliyor" is actionable in a way that a cloud
 * icon with a slash through it is not — and it opens the screen where those
 * three can be looked at, sent again, or given up on.
 */
@MainActor
struct PendingWritesBanner: View {
    @Environment(\.colorScheme) private var scheme

    let sync: SyncCoordinator
    let open: () -> Void

    var body: some View {
        if !sync.isHoldingSomething {
            EmptyView()
        } else {
            Button(action: open) {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: tone.iconName)
                        .font(Tokens.Typography.captionRelative)
                        // The sentence beside it says the same thing.
                        .accessibilityHidden(true)

                    Text(title)
                        .font(Tokens.Typography.captionRelative)
                        .fixedSize(horizontal: false, vertical: true)

                    Spacer(minLength: 0)

                    Text(L10n.string("sync.open"))
                        .font(Tokens.Typography.captionRelative)
                        .underline()
                }
                .foregroundStyle(tone.foreground.resolve(for: scheme))
                .padding(.horizontal, Tokens.Spacing.lg)
                .padding(.vertical, Tokens.Spacing.sm)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                .background(tone.surface.resolve(for: scheme))
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(title)
            .accessibilityHint(L10n.string("sync.open"))
        }
    }

    private var tone: Tone { sync.needsAttention ? .critical : .warning }

    private var title: String {
        if sync.needsAttention { return L10n.string("sync.needsAttention") }
        if sync.heldCount == 1 { return L10n.string("sync.pendingOne") }

        return String(format: L10n.string("sync.pendingCount"), sync.heldCount)
    }
}


/**
 * Signing out, with the queue taken into account.
 *
 * An entry is a request against `me/…` and carries no user of its own, so
 * anything still queued at sign-out has to go — it would otherwise be sent as
 * whoever signs in next, which is one person's blood pressure filed in another
 * person's record. That is a real cost, so it is said before it is paid rather
 * than discovered afterwards.
 */
@MainActor
struct SignOutButton: View {
    let sync: SyncCoordinator
    let signOut: () async -> Void

    @State private var confirming = false

    var body: some View {
        Button(L10n.string("auth.signOut"), role: .destructive) {
            if sync.heldCount == 0 {
                Task { await signOut() }
            } else {
                confirming = true
            }
        }
        .confirmationDialog(
            L10n.string("sync.signOutTitle"),
            isPresented: $confirming,
            titleVisibility: .visible
        ) {
            Button(L10n.string("sync.signOutAnyway"), role: .destructive) {
                Task { await signOut() }
            }
            Button(L10n.string("common.cancel"), role: .cancel) {}
        } message: {
            Text(String(format: L10n.string("sync.signOutWarning"), sync.heldCount))
        }
    }
}

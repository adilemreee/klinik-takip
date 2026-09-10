import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

public enum ChecklistPhase: Sendable, Equatable {
    case loading
    case loaded(Checklist)
    /// The clinic has not set out a list. Not a failure.
    case empty
    case notFound
    case failed(String)
}

public struct ChecklistState: Sendable, Equatable {
    public var phase: ChecklistPhase = .loading

    public init() {}
}

/// What a patient still owes before an operation (spec M17).
public actor ChecklistModel {
    private let api: DocumentsAPI
    private let subject: RecordSubject

    private(set) public var state = ChecklistState()

    public init(api: DocumentsAPI, subject: RecordSubject) {
        self.api = api
        self.subject = subject
    }

    public func currentState() -> ChecklistState { state }

    public func load() async {
        state.phase = .loading

        do {
            let checklist = try await api.checklist(subject: subject)
            state.phase = checklist.items.isEmpty ? .empty : .loaded(checklist)
        } catch let error as APIError {
            if case .notFound = error {
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }
}

/**
 * The pre-operative checklist.
 *
 * Built around what is *missing*, because that is the only part anybody has to
 * act on. A list where six received documents and two outstanding ones look
 * alike is one a patient reads as "something is wrong somewhere" — and then
 * either sends nothing or sends everything again.
 *
 * Only mandatory items count towards completion. Colouring an optional item
 * red teaches people to ignore the colour.
 */
@MainActor
public struct ChecklistScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ChecklistModel
    /// Nil on the staff side: a clinician looking at a patient's file is not
    /// the person who uploads their passport.
    private let upload: ((DocumentType) -> Void)?

    @State private var state = ChecklistState()

    public init(model: ChecklistModel, upload: ((DocumentType) -> Void)? = nil) {
        self.model = model
        self.upload = upload
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                content
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("checklist.title"))
        .task { await reload() }
        .refreshable { await reload() }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            SkeletonCard(lines: 5)
                .accessibilityElement()
                .accessibilityLabel(L10n.string("common.loading"))

        case .empty:
            MessageState(icon: "checklist", text: L10n.string("checklist.empty"))

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("error.notFound"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await reload()
            }

        case .loaded(let checklist):
            summary(checklist)

            Text(L10n.string("checklist.explain"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)

            ForEach(checklist.items) { item in
                ChecklistRow(item: item, upload: upload)
            }
        }
    }

    private func summary(_ checklist: Checklist) -> some View {
        Card(tone: checklist.complete ? .success : .warning) {
            HStack(spacing: Tokens.Spacing.sm) {
                Image(systemName: checklist.complete ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                    .font(Tokens.Typography.headingRelative)
                    .foregroundStyle(
                        (checklist.complete ? Tone.success : Tone.warning).foreground.resolve(for: scheme)
                    )
                    // The sentence beside it says the same thing.
                    .accessibilityHidden(true)

                Text(ChecklistScreen.headline(checklist))
                    .font(Tokens.Typography.subheadingRelative)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func reload() async {
        await model.load()
        state = await model.currentState()
    }

    /// `nonisolated` because a static on a `View` otherwise inherits the
    /// view's main-actor isolation, and the tests call it directly.
    nonisolated static func headline(_ checklist: Checklist) -> String {
        if checklist.complete { return L10n.string("checklist.complete") }
        if checklist.missingMandatory == 1 { return L10n.string("checklist.missingOne") }

        return String(format: L10n.string("checklist.missingCount"), checklist.missingMandatory)
    }
}

/// One document the clinic is waiting for, or has.
struct ChecklistRow: View {
    @Environment(\.colorScheme) private var scheme

    let item: ChecklistItem
    let upload: ((DocumentType) -> Void)?

    var body: some View {
        Card(tone: tone) {
            HStack(alignment: .top, spacing: Tokens.Spacing.md) {
                Image(systemName: item.satisfied ? "checkmark.circle.fill" : "circle")
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(tone.foreground.resolve(for: scheme))
                    // The badge below says the same thing in words.
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(item.label)
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: Tokens.Spacing.sm) {
                        // In words as well as colour: a colour a reader cannot
                        // distinguish says nothing (spec section 7).
                        Badge(
                            L10n.string(item.satisfied ? "checklist.received" : "checklist.missing"),
                            tone: tone
                        )

                        if !item.mandatory {
                            Badge(L10n.string("checklist.optional"))
                        }
                    }
                }

                Spacer(minLength: 0)

                if !item.satisfied, let upload {
                    Button(L10n.string("checklist.upload")) { upload(item.documentType) }
                        .buttonStyle(.borderedProminent)
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// Only a missing *mandatory* item is a warning. An optional one left
    /// undone is not an incomplete file.
    private var tone: Tone {
        if item.satisfied { return .success }

        return item.mandatory ? .warning : .neutral
    }
}

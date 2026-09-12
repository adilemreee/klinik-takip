import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The staff-side patient list.
public struct PatientListView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: PatientListModel
    private let onSelect: (Patient) -> Void

    @State private var state = PatientListState()
    @State private var query = ""

    public init(model: PatientListModel, onSelect: @escaping (Patient) -> Void) {
        self.model = model
        self.onSelect = onSelect
    }

    public var body: some View {
        VStack(spacing: 0) {
            SearchField(text: $query, placeholder: L10n.string("patient.searchHint"))
                .padding(Tokens.Spacing.lg)

            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await run { await model.search(query: "") } }
        // Re-running on every keystroke is fine: the model drops answers for
        // queries the user has moved past, so a fast typist cannot end up
        // looking at stale results.
        .onChange(of: query) { _, newValue in
            Task { await run { await model.search(query: newValue) } }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .idle, .loadingFirstPage:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .empty:
            MessageState(icon: "magnifyingglass", text: L10n.string("patient.empty"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await run { await model.retry() }
            }

        case .loaded:
            List {
                ForEach(state.patients) { patient in
                    Button { onSelect(patient) } label: { PatientRow(patient: patient) }
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }

                if state.hasMore {
                    HStack {
                        Spacer()
                        ProgressView()
                            .accessibilityLabel(L10n.string("common.loading"))
                        Spacer()
                    }
                    // Loading the next page when the footer appears, rather than
                    // making the user find a button.
                    .task { await run { await model.loadMore() } }
                }
            }
            .listStyle(.plain)
        }
    }

    private func run(_ operation: () async -> Void) async {
        await operation()
        state = await model.currentState()
    }
}

/**
 * One patient in the list.
 *
 * The row carried a name and a file number, which is the least a list can say.
 * Two things were missing and both are what somebody scans for: where the
 * patient is in their treatment, and something to fix the eye on while moving
 * down a page of names. The status is a word as well as a colour — a stage a
 * reader cannot tell by hue is no signal at all (spec section 7) — and the
 * initials are a shape, not information, so a screen reader skips them.
 */
struct PatientRow: View {
    @Environment(\.colorScheme) private var scheme
    let patient: Patient

    var body: some View {
        HStack(spacing: Tokens.Spacing.md) {
            Initials(name: patient.fullName)

            VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                Text(patient.fullName)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Text(subtitle)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            Spacer(minLength: Tokens.Spacing.sm)

            Badge(localizedStatus, tone: PatientRow.tone(for: patient.status))
        }
        .padding(.vertical, Tokens.Spacing.xs)
        // One announcement per row rather than five fragments.
        .accessibilityElement(children: .combine)
    }

    /// File number, then where they are from. The city when the clinic has it:
    /// two patients from the same country are told apart by the next line down.
    private var subtitle: String {
        let place = [patient.city, patient.country].compactMap { $0 }.joined(separator: ", ")

        return "\(patient.mrn) · \(place)"
    }

    /// A status the catalogue has no word for is shown as the server spells
    /// it, rather than as a key with a dot in it.
    private var localizedStatus: String {
        L10n.name("patient.status", patient.status)
    }

    /**
     * Colour by where the treatment stands, not by severity.
     *
     * The two that matter are the ones somebody is looking for: a patient
     * about to be operated on, and one who has been and is being followed.
     */
    static func tone(for status: String) -> Tone {
        switch status {
        case "PRE_OP", "SCHEDULED": return .warning
        case "POST_OP", "FOLLOW_UP": return .info
        case "DISCHARGED": return .success
        default: return .neutral
        }
    }
}

/**
 * The first letters of a name, as a shape to scan by.
 *
 * Decorative on purpose: it repeats the name beside it, and a screen reader
 * announcing "A Y, Ayşe Yılmaz" is a list read twice.
 */
struct Initials: View {
    @Environment(\.colorScheme) private var scheme

    let name: String

    var body: some View {
        Text(letters)
            .font(Tokens.Typography.captionRelative)
            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            .frame(width: 40, height: 40)
            .background(Tokens.Palette.infoSurface.resolve(for: scheme))
            .clipShape(Circle())
            .accessibilityHidden(true)
    }

    private var letters: String {
        name
            .split(separator: " ")
            .prefix(2)
            .compactMap { $0.first.map(String.init) }
            .joined()
            .uppercased()
    }
}

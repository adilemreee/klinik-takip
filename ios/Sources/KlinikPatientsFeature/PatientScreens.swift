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

struct PatientRow: View {
    @Environment(\.colorScheme) private var scheme
    let patient: Patient

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
            Text(patient.fullName)
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            Text("\(L10n.string("patient.fileNumber")) \(patient.mrn) · \(patient.country)")
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
        }
        .padding(.vertical, Tokens.Spacing.xs)
        // One announcement per row rather than three fragments.
        .accessibilityElement(children: .combine)
    }
}

/// One patient's file.
public struct PatientDetailView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: PatientDetailModel
    @State private var state = PatientDetailState()

    public init(model: PatientDetailModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            switch state.phase {
            case .loading:
                ProgressView().accessibilityLabel(L10n.string("common.loading"))

            case .notFound:
                // Deliberately the same message a genuinely missing record
                // gets: saying "no access" would confirm the file exists.
                MessageState(icon: "questionmark.circle", text: L10n.string("error.notFound"))

            case .failed(let message):
                MessageState(
                    icon: Tokens.State.labCritical.iconName,
                    text: message,
                    retryTitle: L10n.string("common.retry")
                ) {
                    await load()
                }

            case .loaded(let patient):
                ScrollView {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                        Text(patient.fullName)
                            .font(Tokens.Typography.titleRelative)
                            .accessibilityAddTraits(.isHeader)

                        DetailRow(label: L10n.string("patient.fileNumber"), value: patient.mrn)
                        DetailRow(label: "Ülke", value: patient.country)
                        if let city = patient.city {
                            DetailRow(label: "Şehir", value: city)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Tokens.Spacing.xl)
                }
            }
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await load() }
    }

    private func load() async {
        await model.load()
        state = await model.currentState()
    }
}

struct DetailRow: View {
    @Environment(\.colorScheme) private var scheme
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
            Text(label)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            Text(value)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
        }
        .accessibilityElement(children: .combine)
    }
}

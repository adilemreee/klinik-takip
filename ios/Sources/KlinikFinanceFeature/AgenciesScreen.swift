import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

public enum AgenciesPhase: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case notPermitted
    case failed(String)
}

public struct AgenciesState: Sendable, Equatable {
    public var phase: AgenciesPhase = .loading
    public var agencies: [Agency] = []
    public var busy = false
    public var error: String?

    public init() {}
}

/**
 * The intermediaries that send the clinic patients (spec M19).
 *
 * The commission rate lives here rather than on each invoice: an agency's terms
 * are agreed once and applied to every patient they send, and re-typing them
 * per bill is how one record ends up at 10% and the next at 1%.
 */
@MainActor
public final class AgenciesModel {
    private let api: FinanceAPI
    private var state = AgenciesState()

    public init(api: FinanceAPI) {
        self.api = api
    }

    public func currentState() -> AgenciesState { state }

    public func load() async {
        do {
            state.agencies = try await api.agencies(includeInactive: true)
            state.phase = state.agencies.isEmpty ? .empty : .loaded
        } catch APIError.forbidden {
            state.phase = .notPermitted
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func save(_ agency: NewAgency, existing: String?) async -> Bool {
        state.busy = true
        state.error = nil

        defer { state.busy = false }

        do {
            if let existing {
                _ = try await api.updateAgency(existing, agency)
            } else {
                _ = try await api.createAgency(agency)
            }

            await load()

            return true
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return false
    }

    /**
     * A percentage typed by a person, as the server's pattern wants it.
     *
     * "10" means ten per cent, not ten times the invoice. The field asks for a
     * percentage because that is what a contract says, and this converts —
     * sending "10" where the server expects a fraction of one would bill an
     * agency ten times the operation.
     */
    public nonisolated static func rate(fromPercentage input: String) -> String? {
        let trimmed = input
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "%", with: "")
            .replacingOccurrences(of: ",", with: ".")

        guard !trimmed.isEmpty else { return nil }
        guard let percentage = Double(trimmed), percentage >= 0, percentage <= 100 else {
            return nil
        }

        return String(format: "%.4f", percentage / 100)
    }
}

/// Defining agencies and what they are owed.
public struct AgenciesScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AgenciesModel

    @State private var state = AgenciesState()
    @State private var editing: Agency?
    @State private var adding = false

    public init(model: AgenciesModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    SkeletonCard(lines: 3)
                        .accessibilityElement()
                        .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(icon: "lock", text: L10n.string("finance.notPermitted"))
                        .frame(minHeight: 240)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .empty:
                    MessageState(
                        icon: "building.2",
                        text: L10n.string("agency.empty"),
                        retryTitle: L10n.string("agency.add"),
                        retry: { adding = true }
                    )
                    .frame(minHeight: 240)

                case .loaded:
                    ForEach(state.agencies) { agency in
                        card(agency)
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("agency.title"))
        .refreshable { await reload() }
        .task { await reload() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: {
                    Label(L10n.string("agency.add"), systemImage: "plus")
                }
                .frame(minHeight: Tokens.minimumTouchTarget)
            }
        }
        .sheet(isPresented: $adding) {
            AgencySheet(agency: nil) { agency in
                let ok = await model.save(agency, existing: nil)
                state = model.currentState()

                if ok { adding = false }
            }
        }
        .sheet(item: $editing) { agency in
            AgencySheet(agency: agency) { edit in
                let ok = await model.save(edit, existing: agency.id)
                state = model.currentState()

                if ok { editing = nil }
            }
        }
    }

    private func card(_ agency: Agency) -> some View {
        Button { editing = agency } label: {
            Card(tone: agency.isActive ? .neutral : .warning) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                    HStack(spacing: Tokens.Spacing.md) {
                        InitialsAvatar(name: agency.name, diameter: 40)

                        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                            Text(agency.name)
                                .font(Tokens.Typography.subheadingRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textPrimary.resolve(for: scheme)
                                )

                            if let country = agency.country {
                                Text(country)
                                    .font(Tokens.Typography.captionRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textSecondary.resolve(for: scheme)
                                    )
                            }
                        }

                        Spacer(minLength: Tokens.Spacing.sm)

                        if let percentage = agency.commissionPercentage {
                            Badge(percentage, tone: .info, symbol: "percent")
                        }

                        if !agency.isActive {
                            Badge(L10n.string("agency.inactive"), tone: .warning, symbol: "pause")
                        }
                    }

                    if agency.contactName != nil || agency.contactPhone != nil {
                        LazyVGrid(
                            columns: [
                                GridItem(.flexible(), alignment: .topLeading),
                                GridItem(.flexible(), alignment: .topLeading),
                            ],
                            spacing: Tokens.Spacing.md
                        ) {
                            FieldRow(label: L10n.string("agency.contact"), value: agency.contactName)
                            FieldRow(label: L10n.string("file.phone"), value: agency.contactPhone)
                        }
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(minHeight: Tokens.minimumTouchTarget)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/// Adding or editing one agency.
struct AgencySheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let agency: Agency?
    let submit: (NewAgency) async -> Void

    @State private var name: String
    @State private var country: String
    @State private var contactName: String
    @State private var contactEmail: String
    @State private var contactPhone: String
    @State private var percentage: String
    @State private var busy = false

    init(agency: Agency?, submit: @escaping (NewAgency) async -> Void) {
        self.agency = agency
        self.submit = submit
        _name = State(initialValue: agency?.name ?? "")
        _country = State(initialValue: agency?.country ?? "")
        _contactName = State(initialValue: agency?.contactName ?? "")
        _contactEmail = State(initialValue: agency?.contactEmail ?? "")
        _contactPhone = State(initialValue: agency?.contactPhone ?? "")
        _percentage = State(
            initialValue: agency?.commissionRate
                .flatMap { Double($0) }
                .map { String(format: "%g", $0 * 100) } ?? ""
        )
    }

    var body: some View {
        FormScaffold(
            title: agency == nil ? L10n.string("agency.add") : L10n.string("common.edit"),
            subtitle: agency?.name
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("agency.name"),
                    text: $name,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("patient.countryHint"),
                    text: $country,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("agency.contact"),
                    text: $contactName,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("file.email"),
                    text: $contactEmail,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .emailAddress
                )

                LabelledField(
                    label: L10n.string("file.phone"),
                    text: $contactPhone,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .numberPad
                )

                LabelledField(
                    label: L10n.string("agency.commission"),
                    text: $percentage,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .decimal
                )

                Text(L10n.string("agency.commissionHint"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)

                PrimaryButton(
                    title: L10n.string("common.save"),
                    isBusy: busy,
                    isEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty && !busy
                ) {
                    busy = true
                    await submit(edit)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    private var edit: NewAgency {
        NewAgency(
            name: name.trimmingCharacters(in: .whitespaces),
            country: country.isEmpty ? nil : country,
            contactName: contactName.isEmpty ? nil : contactName,
            contactEmail: contactEmail.isEmpty ? nil : contactEmail,
            contactPhone: contactPhone.isEmpty ? nil : contactPhone,
            commissionRate: AgenciesModel.rate(fromPercentage: percentage)
        )
    }
}

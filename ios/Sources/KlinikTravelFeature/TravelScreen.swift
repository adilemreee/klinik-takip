import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The trip (spec M19).
 *
 * The same screen serves the coordinator who books it and the patient who is
 * living it, because they need the same facts — which flight, which hotel, who
 * is meeting me — and only the coordinator gets an edit button.
 *
 * The clearance to fly sits apart from everything else and is worded as what it
 * is: a named clinician's decision, with their name on it. Nothing here works
 * out a waiting period from a surgery date, because that would be the app
 * issuing medical advice nobody reviewed.
 */
public struct TravelScreen: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL

    private let model: TravelModel
    private let canEdit: Bool
    private let canClear: Bool

    @State private var state = TravelState()
    @State private var editing = false

    /// - Parameters:
    ///   - canEdit: `patients.write`. False on the patient's own copy.
    ///   - canClear: `medical.decide`. False for a coordinator, who sees the
    ///     clearance and cannot change it.
    public init(model: TravelModel, canEdit: Bool = false, canClear: Bool = false) {
        self.model = model
        self.canEdit = canEdit
        self.canClear = canClear
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    SkeletonCard(lines: 4)
                        .accessibilityElement()
                        .accessibilityLabel(L10n.string("common.loading"))

                case .notFound:
                    MessageState(icon: "airplane", text: L10n.string("travel.none"))
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
                    if let plan = state.plan, !plan.isEmpty {
                        clearance(plan)
                        flights(plan)
                        hotel(plan)
                        welcome(plan)
                        interpreter(plan)
                        notes(plan)
                    } else {
                        empty
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("travel.title"))
        .refreshable { await reload() }
        .task { await reload() }
        .toolbar {
            if canEdit {
                ToolbarItem(placement: .primaryAction) {
                    Button { editing = true } label: {
                        Label(L10n.string("common.edit"), systemImage: "pencil")
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }
        }
        .sheet(isPresented: $editing) {
            EditTravelSheet(plan: state.plan) { edit in
                let ok = await model.save(edit)
                state = model.currentState()

                if ok { editing = false }
            }
        }
    }

    private var empty: some View {
        MessageState(
            icon: "airplane",
            text: canEdit ? L10n.string("travel.emptyStaff") : L10n.string("travel.none"),
            retryTitle: canEdit ? L10n.string("travel.fillIn") : nil,
            retry: canEdit ? { editing = true } : nil
        )
        .frame(minHeight: 280)
    }

    /// The one clinical statement on this screen, and it carries a name.
    private func clearance(_ plan: TravelPlan) -> some View {
        Card(tone: plan.isClearedToFly ? .success : .warning) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: plan.isClearedToFly ? "checkmark.seal.fill" : "clock.badge.exclamationmark")
                        .font(Tokens.Typography.headingRelative)
                        .foregroundStyle(
                            (plan.isClearedToFly ? Tokens.Palette.success : Tokens.Palette.warning)
                                .resolve(for: scheme)
                        )
                        .accessibilityHidden(true)

                    Text(
                        L10n.string(
                            plan.isClearedToFly ? "travel.clearedToFly" : "travel.notClearedToFly"
                        )
                    )
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
                }

                if let by = state.clearedToFlyBy, let at = plan.clearedToFlyAt {
                    Text(
                        String(
                            format: L10n.string("travel.clearedBy"),
                            by,
                            at.formatted(date: .abbreviated, time: .shortened)
                        )
                    )
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                if canClear {
                    Toggle(
                        L10n.string("travel.clearanceToggle"),
                        isOn: Binding(
                            get: { plan.isClearedToFly },
                            set: { cleared in
                                Task {
                                    await model.setClearedToFly(cleared)
                                    state = model.currentState()
                                }
                            }
                        )
                    )
                    .font(Tokens.Typography.bodyRelative)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .disabled(state.saving)
                }
            }
        }
    }

    @ViewBuilder
    private func flights(_ plan: TravelPlan) -> some View {
        if plan.hasFlights {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("travel.flights"))

                Card {
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), alignment: .topLeading),
                            GridItem(.flexible(), alignment: .topLeading),
                        ],
                        spacing: Tokens.Spacing.md
                    ) {
                        FieldRow(label: L10n.string("travel.arrivalFlight"), value: plan.arrivalFlight)
                        FieldRow(
                            label: L10n.string("travel.arrivalAt"),
                            value: plan.arrivalAt?.formatted(date: .abbreviated, time: .shortened)
                        )
                        FieldRow(
                            label: L10n.string("travel.departureFlight"),
                            value: plan.departureFlight
                        )
                        FieldRow(
                            label: L10n.string("travel.departureAt"),
                            value: plan.departureAt?.formatted(date: .abbreviated, time: .shortened)
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func hotel(_ plan: TravelPlan) -> some View {
        if plan.hasHotel {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("travel.hotel"))

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        FieldRow(label: L10n.string("travel.hotelName"), value: plan.hotelName)
                        FieldRow(label: L10n.string("travel.hotelAddress"), value: plan.hotelAddress)

                        LazyVGrid(
                            columns: [
                                GridItem(.flexible(), alignment: .topLeading),
                                GridItem(.flexible(), alignment: .topLeading),
                            ],
                            spacing: Tokens.Spacing.md
                        ) {
                            FieldRow(
                                label: L10n.string("travel.checkIn"),
                                value: plan.hotelCheckIn?.formatted(date: .abbreviated, time: .omitted)
                            )
                            FieldRow(
                                label: L10n.string("travel.checkOut"),
                                value: plan.hotelCheckOut?.formatted(date: .abbreviated, time: .omitted)
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func welcome(_ plan: TravelPlan) -> some View {
        if plan.greeterName != nil || plan.transferNote?.isEmpty == false {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("travel.welcome"))

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        FieldRow(label: L10n.string("travel.greeter"), value: plan.greeterName)

                        if let phone = plan.greeterPhone, let url = URL(string: "tel://\(phone)") {
                            Button { openURL(url) } label: {
                                Label(phone, systemImage: "phone.fill")
                                    .font(Tokens.Typography.subheadingRelative)
                                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                                    .foregroundStyle(
                                        Tokens.Palette.accentText.resolve(for: scheme)
                                    )
                                    .background(Tokens.Palette.success.resolve(for: scheme))
                                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                            }
                        }

                        FieldRow(label: L10n.string("travel.transfer"), value: plan.transferNote)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func interpreter(_ plan: TravelPlan) -> some View {
        if plan.hasInterpreter {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("travel.interpreter"))

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        HStack(spacing: Tokens.Spacing.md) {
                            InitialsAvatar(name: plan.interpreterName ?? "", diameter: 40)

                            VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                                Text(plan.interpreterName ?? "")
                                    .font(Tokens.Typography.subheadingRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textPrimary.resolve(for: scheme)
                                    )

                                if let language = plan.interpreterLanguage {
                                    Text(language.localizedUppercase)
                                        .font(Tokens.Typography.captionRelative)
                                        .foregroundStyle(
                                            Tokens.Palette.textSecondary.resolve(for: scheme)
                                        )
                                }
                            }

                            Spacer(minLength: 0)
                        }
                        .accessibilityElement(children: .combine)

                        if let phone = plan.interpreterPhone,
                           let url = URL(string: "tel://\(phone)") {
                            Button { openURL(url) } label: {
                                Label(phone, systemImage: "phone")
                                    .font(Tokens.Typography.calloutRelative)
                                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func notes(_ plan: TravelPlan) -> some View {
        if let note = plan.notes, !note.isEmpty {
            Card {
                FieldRow(label: L10n.string("file.notes"), value: note)
            }
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

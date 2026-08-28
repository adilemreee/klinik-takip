import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The patient's home screen.
///
/// One screen, one job (spec section 7). Everything else the app can do is
/// reached from exactly five tiles, and the emergency one is always the last
/// and always visible — a patient in trouble should not have to scroll.
public struct HomeScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: HomeModel
    private let emergency: EmergencyModel
    private let onSelect: (HomeAction) -> Void

    @State private var state = HomeState()
    @State private var emergencyState = EmergencyState()

    public init(
        model: HomeModel,
        emergency: EmergencyModel,
        onSelect: @escaping (HomeAction) -> Void
    ) {
        self.model = model
        self.emergency = emergency
        self.onSelect = onSelect
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                header
                actions
            }
            .padding(Tokens.Spacing.xl)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task {
            await model.load()
            state = await model.currentState()
        }
        .sheet(isPresented: .constant(isEmergencySheetShowing)) {
            EmergencySheet(state: emergencyState) { action in
                switch action {
                case .confirm: await emergency.confirm()
                case .cancel: await emergency.cancel()
                case .acknowledge: await emergency.acknowledge()
                }
                emergencyState = await emergency.currentState()
            }
        }
    }

    private var isEmergencySheetShowing: Bool {
        emergencyState.phase != .idle
    }

    @ViewBuilder
    private var header: some View {
        switch state.phase {
        case .loading:
            ProgressView().accessibilityLabel(L10n.string("common.loading"))

        case .noPatientFile:
            // Not retryable, so no retry button: the patient needs to contact
            // the clinic, not tap again.
            MessageState(icon: "person.crop.circle.badge.questionmark",
                         text: L10n.string("home.noPatientFile"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await model.load()
                state = await model.currentState()
            }

        case .loaded(let summary):
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                Text("\(L10n.string("home.title")), \(summary.patient.firstName)")
                    .font(Tokens.Typography.titleRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .accessibilityAddTraits(.isHeader)

                if let appointment = summary.nextAppointment {
                    Text("\(L10n.string("home.nextAppointment")): \(appointment.scheduledAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            }
        }
    }

    private var actions: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: Tokens.Spacing.md),
                      GridItem(.flexible(), spacing: Tokens.Spacing.md)],
            spacing: Tokens.Spacing.md
        ) {
            ForEach(HomeAction.allCases) { action in
                ActionTile(
                    action: action,
                    badge: state.badges[action.rawValue],
                    scheme: scheme
                ) {
                    if action == .emergency {
                        // First tap only arms it (spec M8).
                        await emergency.arm()
                        emergencyState = await emergency.currentState()
                    } else {
                        onSelect(action)
                    }
                }
            }
        }
    }
}

struct ActionTile: View {
    let action: HomeAction
    let badge: Int?
    let scheme: ColorScheme
    let tap: () async -> Void

    private var isEmergency: Bool { action == .emergency }

    var body: some View {
        Button {
            Task { await tap() }
        } label: {
            VStack(spacing: Tokens.Spacing.sm) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: action.iconName)
                        .font(.system(size: 28))

                    if let badge {
                        Text("\(badge)")
                            .font(Tokens.Typography.captionRelative)
                            .padding(Tokens.Spacing.xs)
                            .background(Tokens.Palette.critical.resolve(for: scheme))
                            .foregroundStyle(Tokens.Palette.accentText.resolve(for: scheme))
                            .clipShape(Circle())
                            .offset(x: 14, y: -8)
                    }
                }

                Text(L10n.string(action.titleKey))
                    .font(Tokens.Typography.subheadingRelative)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 110)
            .padding(Tokens.Spacing.lg)
            .foregroundStyle(
                (isEmergency ? Tokens.Palette.accentText : Tokens.Palette.textPrimary)
                    .resolve(for: scheme)
            )
            .background(
                (isEmergency ? Tokens.Palette.critical : Tokens.Palette.surface)
                    .resolve(for: scheme)
            )
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.lg))
        }
        // One announcement per tile, including the count, rather than three
        // fragments a screen-reader user has to assemble.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            badge == nil
                ? L10n.string(action.titleKey)
                : "\(L10n.string(action.titleKey)), \(badge!)"
        )
    }
}

enum EmergencySheetAction {
    case confirm, cancel, acknowledge
}

/// The confirming step, the outcome, and — when the alert did not get through —
/// the local emergency number.
struct EmergencySheet: View {
    @Environment(\.colorScheme) private var scheme

    let state: EmergencyState
    let perform: (EmergencySheetAction) async -> Void

    var body: some View {
        VStack(spacing: Tokens.Spacing.xl) {
            switch state.phase {
            case .confirming(let seconds):
                Text(L10n.string("emergency.confirmTitle"))
                    .font(Tokens.Typography.headingRelative)
                    .accessibilityAddTraits(.isHeader)

                Text(L10n.string("emergency.confirmHint"))
                    .font(Tokens.Typography.bodyRelative)
                    .multilineTextAlignment(.center)

                PrimaryButton(
                    title: "\(L10n.string("emergency.confirmAction")) (\(seconds))",
                    isBusy: false,
                    isEnabled: true
                ) {
                    await perform(.confirm)
                }

                Button(L10n.string("common.cancel")) { Task { await perform(.cancel) } }
                    .frame(minHeight: Tokens.minimumTouchTarget)

            case .sending:
                ProgressView()
                Text(L10n.string("emergency.sending"))

            case .sent:
                Image(systemName: Tokens.State.labNormal.iconName)
                    .font(.system(size: 44))
                    .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                Text(L10n.string("emergency.sent"))
                    .multilineTextAlignment(.center)
                PrimaryButton(title: L10n.string("common.close"), isBusy: false, isEnabled: true) {
                    await perform(.acknowledge)
                }

            case .failed(let message, _):
                // Says plainly that the clinic has not been told, and offers
                // the number that will actually reach someone.
                Image(systemName: Tokens.State.labCritical.iconName)
                    .font(.system(size: 44))
                    .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))

                Text(message)
                    .multilineTextAlignment(.center)
                    .font(Tokens.Typography.bodyRelative)

                PrimaryButton(
                    title: L10n.string("common.retry"),
                    isBusy: false,
                    isEnabled: true
                ) {
                    await perform(.confirm)
                }

                Button(L10n.string("common.close")) { Task { await perform(.acknowledge) } }
                    .frame(minHeight: Tokens.minimumTouchTarget)

            case .idle:
                EmptyView()
            }
        }
        .padding(Tokens.Spacing.xxl)
        .frame(maxWidth: .infinity)
        .background(Tokens.Palette.background.resolve(for: scheme))
    }
}

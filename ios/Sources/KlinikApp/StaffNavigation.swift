import SwiftUI
import KlinikAPI
import KlinikAppointmentsFeature
import KlinikAuditFeature
import KlinikAuthFeature
import KlinikBriefingFeature
import KlinikComplicationsFeature
import KlinikCore
import KlinikDesign
import KlinikAnalyticsFeature
import KlinikDocumentsFeature
import KlinikExportsFeature
import KlinikFinanceFeature
import KlinikEmergencyFeature
import KlinikFollowUpFeature
import KlinikLabFeature
import KlinikMeasurementsFeature
import KlinikMedicationsFeature
import KlinikMessagingFeature
import KlinikNotificationsFeature
import KlinikPatientsFeature
import KlinikPhotosFeature
import KlinikProtocolsFeature
import KlinikReportsFeature
import KlinikSurveysFeature

/**
 * Where clinic staff can get to (T2.6).
 *
 * Most destinations carry a patient id. That is not a convenience: every one
 * of these screens is somebody's clinical record, and making the id part of
 * the route means a screen cannot be opened without saying whose file it is.
 */
public enum StaffDestination: Hashable, Sendable {
    case patient(id: String, name: String)
    case measurements(patientId: String)
    case documents(patientId: String)
    case labReview(patientId: String)
    case labTrend(patientId: String)
    case photos(patientId: String)
    case followUp(patientId: String)
    case conversation(patientId: String)
    case appointments(patientId: String)
    /// Across all patients, not one — the point of a triage queue.
    case complicationQueue
    case medications(patientId: String)
    case invite(patientId: String, name: String)
    case account
    /// Every patient the caller can see, a month at a time (spec M10).
    case calendar
    case analytics
    case finance
    case exports
    case audit
    case protocols
    case surveys(patientId: String)
    /// AI output nobody has signed off yet (spec M5).
    case pendingReports
    case notificationSettings
    case newPatient
}

/// The three things a clinician does often enough to deserve a tab.
enum StaffTab: Hashable {
    case agenda
    case patients
    case emergency
}

/**
 * The staff side of the app.
 *
 * Three tabs rather than one list with a menu hanging off it. The agenda is
 * first because it is what a clinician opens the app to read; the emergency
 * queue is a tab of its own rather than a menu item because a call nobody can
 * find is a call nobody answers, and a menu is where things go to be missed.
 *
 * Each tab keeps its own navigation stack, so following a name from the agenda
 * into a file does not disturb whatever the patients tab was showing.
 */
@MainActor
struct StaffPatientsView: View {
    let environment: AppEnvironment
    let signOut: () async -> Void
    /// The device-lock setting, owned by the shell and edited on the account
    /// screen.
    let biometrics: BiometricSetting

    @State private var tab: StaffTab = .agenda
    @State private var agendaPath: [StaffDestination] = []
    @State private var patientsPath: [StaffDestination] = []
    @State private var emergencyPath: [StaffDestination] = []

    var body: some View {
        TabView(selection: $tab) {
            agenda
                .tabItem { Label(L10n.string("menu.agenda"), systemImage: "sun.horizon") }
                .tag(StaffTab.agenda)

            patients
                .tabItem { Label(L10n.string("menu.patients"), systemImage: "person.2") }
                .tag(StaffTab.patients)

            emergency
                .tabItem {
                    Label(L10n.string("menu.emergencyQueue"), systemImage: "cross.case")
                }
                .tag(StaffTab.emergency)
        }
    }

    private var agenda: some View {
        NavigationStack(path: $agendaPath) {
            StaffHomeScreen(
                model: StaffHomeModel(
                    briefing: environment.briefing,
                    emergency: environment.emergency,
                    reports: environment.reports
                ),
                onSelect: { target in
                    switch target {
                    case .patient(let id, let name):
                        agendaPath.append(.patient(id: id, name: name))
                    case .pendingReports:
                        agendaPath.append(.pendingReports)
                    case .emergencyQueue:
                        // A tab, not a push: the queue has its own place, and
                        // burying a second copy inside the agenda's stack would
                        // leave two back buttons to the same list.
                        tab = .emergency
                    }
                }
            )
            .navigationTitle(L10n.string("menu.agenda"))
            .navigationDestination(for: StaffDestination.self) { destination in
                screen(for: destination) { agendaPath.append($0) }
            }
            .toolbar { ToolbarItem(placement: .primaryAction) { menu($agendaPath) } }
        }
    }

    private var patients: some View {
        NavigationStack(path: $patientsPath) {
            PatientListView(
                model: PatientListModel(api: environment.patients),
                onSelect: { patient in
                    patientsPath.append(.patient(id: patient.id, name: patient.fullName))
                }
            )
            .navigationTitle(L10n.string("menu.patients"))
            .navigationDestination(for: StaffDestination.self) { destination in
                screen(for: destination) { patientsPath.append($0) }
            }
            .toolbar { ToolbarItem(placement: .primaryAction) { menu($patientsPath) } }
        }
    }

    private var emergency: some View {
        NavigationStack(path: $emergencyPath) {
            EmergencyQueueScreen(
                model: EmergencyQueueModel(api: environment.emergency),
                openFile: { id, name in emergencyPath.append(.patient(id: id, name: name)) }
            )
            .navigationDestination(for: StaffDestination.self) { destination in
                screen(for: destination) { emergencyPath.append($0) }
            }
        }
    }

    private func menu(_ path: Binding<[StaffDestination]>) -> some View {
        Menu {
            Button(L10n.string("patient.new")) { path.wrappedValue.append(.newPatient) }

            Divider()

            Button(L10n.string("menu.calendar")) { path.wrappedValue.append(.calendar) }
            Button(L10n.string("menu.analytics")) { path.wrappedValue.append(.analytics) }
            Button(L10n.string("menu.finance")) { path.wrappedValue.append(.finance) }
            Button(L10n.string("menu.exports")) { path.wrappedValue.append(.exports) }
            Button(L10n.string("menu.audit")) { path.wrappedValue.append(.audit) }
            Button(L10n.string("menu.protocols")) { path.wrappedValue.append(.protocols) }
            Button(L10n.string("menu.complicationQueue")) {
                path.wrappedValue.append(.complicationQueue)
            }
            Button(L10n.string("notification.settingsTitle")) {
                path.wrappedValue.append(.notificationSettings)
            }
            Button(L10n.string("menu.account")) { path.wrappedValue.append(.account) }

            Divider()

            Button(L10n.string("auth.signOut"), role: .destructive) {
                Task { await signOut() }
            }
        } label: {
            Label(L10n.string("common.more"), systemImage: "ellipsis.circle")
        }
    }

    @ViewBuilder
    private func screen(
        for destination: StaffDestination,
        push: @escaping (StaffDestination) -> Void
    ) -> some View {
        switch destination {
        case .patient(let id, let name):
            PatientFileScreen(
                model: PatientFileModel(api: environment.patients, patientId: id),
                onSection: { section in push(StaffDestination(section, patientId: id)) },
                onInvite: { push(.invite(patientId: id, name: name)) }
            )
            .navigationTitle(name)

        case .medications(let patientId):
            PrescribingScreen(
                model: PrescribingModel(api: environment.medications, patientId: patientId)
            )

        case .invite(let patientId, let name):
            InviteView(
                model: InviteModel(api: environment.auth, patientId: patientId),
                patientName: name
            )

        case .account:
            AccountScreen(
                model: AccountModel(api: environment.auth),
                signOut: signOut,
                biometrics: biometrics
            )

        case .calendar:
            CalendarScreen(
                model: CalendarModel(api: environment.appointments),
                openPatient: { id, name in push(.patient(id: id, name: name)) }
            )

        case .analytics:
            AnalyticsScreen(model: AnalyticsModel(api: environment.analytics))

        case .exports:
            ExportsScreen(model: ExportsModel(api: environment.exports))

        case .audit:
            AuditScreen(model: AuditModel(api: environment.audit))

        case .protocols:
            ProtocolsScreen(model: ProtocolsModel(api: environment.protocols))

        case .surveys(let patientId):
            SurveyTrendScreen(
                model: SurveyTrendModel(api: environment.surveys, patientId: patientId)
            )

        case .finance:
            FinanceScreen(
                model: FinanceModel(api: environment.finance),
                openPatient: { id, name in push(.patient(id: id, name: name)) }
            )

        case .pendingReports:
            ReportReviewScreen(
                model: ReportReviewModel(api: environment.reports),
                openPatient: { id, name in push(.patient(id: id, name: name)) }
            )

        case .measurements(let patientId):
            BodyChartView(
                model: MeasurementsModel(
                    api: environment.measurements,
                    subject: .patient(id: patientId),
                    // Recorded as a nurse's reading, because it is one. The
                    // server keeps the distinction; sending `.patient` from a
                    // staff build would launder an unverified number.
                    source: .nurse
                )
            )

        case .documents(let patientId):
            DocumentListView(
                model: DocumentsModel(
                    api: environment.documents,
                    resumable: environment.resumable,
                    subject: .patient(id: patientId)
                ),
                pickFile: { await FilePicker.present() },
                // The camera path (spec M16). Nil on a device with no document
                // scanner, which hides the button rather than offering one that
                // fails when pressed.
                scan: DocumentScanner.isAvailable
                    ? {
                        guard let scanned = await DocumentScanner.present() else { return nil }

                        return (scanned.url, scanned.contentType, scanned.preview)
                    }
                    : nil
            )

        case .labReview(let patientId):
            LabReviewScreen(model: LabReviewModel(api: environment.lab, patientId: patientId))

        case .labTrend(let patientId):
            LabTrendScreen(model: LabTrendModel(api: environment.lab, subject: .patient(id: patientId)))

        case .photos(let patientId):
            PhotoGalleryView(
                model: PhotoGalleryModel(api: environment.photos, subject: .patient(id: patientId)),
                linkFor: { [photos = environment.photos] id in
                    guard let link = try? await photos.link(photoId: id) else { return nil }
                    return URL(string: link.url)
                }
            )

        case .followUp(let patientId):
            // Staff may mark a visit attended; a patient only reads.
            FollowUpScreen(
                model: FollowUpModel(api: environment.followUp, patientId: patientId),
                canMark: true
            )

        case .conversation(let patientId):
            ChatScreen(
                model: ChatModel(api: environment.messaging) {
                    try await environment.messaging.conversation(patientId: patientId)
                },
                canUseTemplates: true,
                pickAttachment: { await FilePicker.present() }
            )

        case .appointments(let patientId):
            // Staff confirm a requested slot; a patient only asks and cancels.
            AppointmentsScreen(
                model: AppointmentsModel(api: environment.appointments, patientId: patientId),
                canConfirm: true
            )

        case .complicationQueue:
            ComplicationQueueView(model: ComplicationQueueModel(api: environment.complications))

        case .newPatient:
            NewPatientView(
                model: NewPatientModel(api: environment.patients),
                onCreated: { _ in
                    // The list reloads when it comes back into view; opening
                    // the new file straight away would take somebody away from
                    // the number they are about to write down.
                }
            )

        case .notificationSettings:
            NotificationSettingsScreen(
                model: NotificationSettingsModel(api: environment.notifications)
            )
        }
    }
}

private extension StaffDestination {
    /// The file names its sections; the app decides where they lead.
    init(_ section: FileSection, patientId: String) {
        switch section {
        case .messages: self = .conversation(patientId: patientId)
        case .measurements: self = .measurements(patientId: patientId)
        case .medications: self = .medications(patientId: patientId)
        case .documents: self = .documents(patientId: patientId)
        case .labReview: self = .labReview(patientId: patientId)
        case .labTrend: self = .labTrend(patientId: patientId)
        case .photos: self = .photos(patientId: patientId)
        case .followUp: self = .followUp(patientId: patientId)
        case .appointments: self = .appointments(patientId: patientId)
        case .surveys: self = .surveys(patientId: patientId)
        }
    }
}

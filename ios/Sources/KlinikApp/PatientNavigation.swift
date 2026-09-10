import SwiftUI
import KlinikAPI
import KlinikAppointmentsFeature
import KlinikAuthFeature
import KlinikAssistantFeature
import KlinikComplicationsFeature
import KlinikConsentsFeature
import KlinikCore
import KlinikDesign
import KlinikDocumentsFeature
import KlinikFollowUpFeature
import KlinikHomeFeature
import KlinikLabFeature
import KlinikMeasurementsFeature
import KlinikMedicationsFeature
import KlinikMessagingFeature
import KlinikNotificationsFeature
import KlinikPhotosFeature
import KlinikSurveysFeature
import KlinikTravelFeature

/**
 * Where a patient can get to (T2.6).
 *
 * A closed enum rather than free-form routing, so every reachable screen is
 * listed in one place and a screen nobody can reach fails to compile rather
 * than quietly existing.
 */
public enum PatientDestination: Hashable, Sendable {
    case messages
    case documents
    case medications
    case photos
    case addPhoto
    case measurements
    case followUp
    case labResults
    case complications
    case appointments
    case notificationSettings
    case consents
    /// The FAQ assistant that stands in front of the clinic (spec M4).
    case assistant
    case account
    case surveys
    case travel
    /// What the app is holding and has not delivered (spec M15).
    case pendingChanges
    /// Documents the clinic needs before the operation (spec M17).
    case checklist
    /// Reading and signing the treatment consent (spec M17).
    case signConsent
}

/**
 * The patient's side of the app.
 *
 * The home screen stays the root and keeps its five primary actions (spec §7);
 * everything else hangs off the toolbar menu. That split is the spec's, not a
 * layout convenience — the five are the things somebody recovering from
 * surgery should not have to hunt for, and burying them in a tab bar with
 * seven peers would undo the decision.
 */
@MainActor
struct PatientHomeView: View {
    @Environment(\.openURL) private var openURL

    let environment: AppEnvironment
    let patientId: String?
    let signOut: () async -> Void
    /// The device-lock setting, owned by the shell and edited on the account
    /// screen.
    let biometrics: BiometricSetting

    @State private var path: [PatientDestination] = []
    @State private var health: HealthSync

    init(
        environment: AppEnvironment,
        patientId: String?,
        signOut: @escaping () async -> Void,
        biometrics: BiometricSetting
    ) {
        self.environment = environment
        self.patientId = patientId
        self.signOut = signOut
        self.biometrics = biometrics
        _health = State(initialValue: HealthSync(measurements: environment.measurements))
    }

    /// The sentence under the button after a synchronisation. Said in words
    /// rather than a count alone: "0" reads as a failure when it usually means
    /// there was nothing new since this morning.
    private func syncHealth() async -> String {
        switch await health.sync() {
        case .synced(let count):
            return String(format: L10n.string("health.synced"), count)
        case .queued(let count):
            return String(format: L10n.string("health.queued"), count)
        case .nothingNew:
            return L10n.string("health.nothingNew")
        case .denied:
            return L10n.string("health.denied")
        case .unavailable:
            return L10n.string("health.unavailable")
        case .failed(let message):
            return message
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                // Inside the stack rather than above it, so tapping it can go
                // somewhere. A queue nobody can open is a queue nobody trusts.
                PendingWritesBanner(sync: environment.sync) {
                    path.append(.pendingChanges)
                }

                home
            }
            .navigationDestination(for: PatientDestination.self) { destination in
                screen(for: destination)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) { menu }
            }
        }
    }

    private var home: some View {
        HomeScreen(
            model: HomeModel(api: environment.me),
            emergency: EmergencyModel(
                trigger: APIEmergencyTrigger(api: environment.emergency)
            ),
            onSelect: { action in
                // The emergency action is not a destination: it arms the
                // two-step confirmation in place. Pushing a screen would put a
                // navigation animation between a patient and the button they
                // just pressed.
                if let destination = PatientHomeView.destination(for: action) {
                    path.append(destination)
                }
            }
        )
    }

    /// The four home actions that lead somewhere. `emergency` deliberately does not.
    static func destination(for action: HomeAction) -> PatientDestination? {
        switch action {
        case .messages: return .messages
        case .uploadDocument: return .documents
        case .medications: return .medications
        case .addPhoto: return .addPhoto
        case .emergency: return nil
        }
    }

    private var menu: some View {
        Menu {
            Button(L10n.string("menu.assistant")) { path.append(.assistant) }
            Button(L10n.string("menu.surveys")) { path.append(.surveys) }
            Button(L10n.string("menu.travel")) { path.append(.travel) }
            Button(L10n.string("menu.photos")) { path.append(.photos) }
            Button(L10n.string("menu.measurements")) { path.append(.measurements) }
            Button(L10n.string("menu.followUp")) { path.append(.followUp) }
            Button(L10n.string("menu.labResults")) { path.append(.labResults) }
            Button(L10n.string("menu.complications")) { path.append(.complications) }
            Button(L10n.string("menu.appointments")) { path.append(.appointments) }
            Button(L10n.string("consent.title")) { path.append(.consents) }
            Button(L10n.string("notification.settingsTitle")) { path.append(.notificationSettings) }
            Button(L10n.string("menu.account")) { path.append(.account) }
            Button(L10n.string("menu.checklist")) { path.append(.checklist) }
            Button(L10n.string("menu.pendingChanges")) { path.append(.pendingChanges) }

            Divider()

            SignOutButton(sync: environment.sync, signOut: signOut)
        } label: {
            Label(L10n.string("common.more"), systemImage: "ellipsis.circle")
        }
    }

    @ViewBuilder
    private func screen(for destination: PatientDestination) -> some View {
        switch destination {
        case .messages:
            ChatScreen(
                model: ChatModel(api: environment.messaging, queue: environment.queue) {
                    // A patient has exactly one conversation with the clinic,
                    // and the server decides which — asking for it by id here
                    // would let the client name someone else's.
                    try await environment.messaging.myConversation()
                },
                // Spec M4 puts the assistant in front of the clinic rather
                // than beside it: a question it can answer from the clinic's
                // own documents does not need to wait for a nurse.
                openAssistant: { path.append(.assistant) },
                // The same picker the documents screen uses, and the same
                // types: the server accepts a superset for messages, so
                // nothing offered here can be refused on arrival.
                pickAttachment: { await FilePicker.present() }
            )

        case .assistant:
            AssistantScreen(
                model: AssistantModel(api: environment.assistant),
                openConversation: {
                    // Replaces the assistant rather than stacking on it: going
                    // back from the conversation should reach the home screen,
                    // not the bot the patient chose to leave.
                    path.removeLast()
                    path.append(.messages)
                }
            )

        case .documents:
            DocumentListView(
                model: DocumentsModel(
                    api: environment.documents,
                    resumable: environment.resumable,
                    // `.me`, never the file id: the staff path needs
                    // documents.read, which a patient must not have.
                    subject: .me,
                    queue: environment.fileQueue
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

        case .medications:
            MedicationsScreen(
                model: MedicationsModel(api: environment.medications, queue: environment.queue)
            )

        case .photos:
            PhotoGalleryView(
                model: PhotoGalleryModel(api: environment.photos, subject: .me),
                linkFor: { [photos = environment.photos] id in
                    // A signed URL, fetched per photo. Nil rather than a
                    // placeholder image: a before/after comparison showing the
                    // wrong picture is worse than showing none.
                    guard let link = try? await photos.link(photoId: id) else { return nil }
                    return URL(string: link.url)
                }
            )

        case .addPhoto:
            AddPhotoView(
                model: PhotoGalleryModel(api: environment.photos, subject: .me),
                capture: { reference in
                    // The reference is downloaded here rather than inside the
                    // capture screen: it needs a signed URL, and those are
                    // short-lived on purpose.
                    let image = await referenceImage(for: reference, photos: environment.photos)

                    return await PhotoCapture.present(reference: reference, referenceImage: image)
                }
            )

        case .measurements:
            // The chart, not just the entry sheet. A patient typing a weight
            // every morning and never seeing the curve it makes is a patient
            // filling in somebody else's form.
            BodyChartView(
                model: MeasurementsModel(
                    api: environment.measurements,
                    subject: .me,
                    // A reading a patient types is recorded as theirs. The
                    // server decides this too; sending `.nurse` from a patient
                    // build would put unverified numbers in a clinical record
                    // wearing a nurse's authority.
                    source: .patient,
                    queue: environment.queue
                ),
                syncFromDevice: health.isAvailable ? { await syncHealth() } : nil
            )

        case .followUp:
            FollowUpScreen(model: FollowUpModel(api: environment.followUp))

        case .labResults:
            LabTrendScreen(model: LabTrendModel(api: environment.lab, subject: .me))

        case .complications:
            MyComplicationsView(model: MyComplicationsModel(api: environment.complications))

        case .appointments:
            AppointmentsScreen(model: AppointmentsModel(api: environment.appointments))

        case .consents:
            ConsentsView(
                model: ConsentsModel(api: environment.consents),
                openNotice: {
                    // The full notice is a document, not a screen: it changes
                    // with the clinic's legal review rather than with a release,
                    // so it is served rather than compiled in.
                    if let url = environment.privacyNoticeURL {
                        openURL(url)
                    }
                },
                signTreatmentConsent: { path.append(.signConsent) }
            )

        case .notificationSettings:
            NotificationSettingsScreen(
                model: NotificationSettingsModel(api: environment.notifications)
            )

        case .account:
            AccountScreen(
                model: AccountModel(api: environment.auth),
                signOut: signOut,
                biometrics: biometrics
            )

        case .surveys:
            SurveyScreen(model: SurveyModel(api: environment.surveys))

        case .travel:
            // Read-only: the patient sees the trip the clinic booked, and the
            // model reads `me/travel`, which needs no `patients.read`.
            TravelScreen(model: TravelModel(api: environment.travel))

        case .pendingChanges:
            PendingChangesScreen(sync: environment.sync)

        case .checklist:
            ChecklistScreen(
                model: ChecklistModel(api: environment.documents, subject: .me),
                // Straight to the upload screen. A checklist that names what is
                // missing and offers no way to send it is a list of complaints.
                upload: { _ in path.append(.documents) }
            )

        case .signConsent:
            SignConsentScreen(
                model: SignConsentModel(legal: environment.legal, consents: environment.consents)
            )
        }
    }
}

/**
 * An account with no patient file linked yet.
 *
 * Reachable: an invitation creates the account before the clinic links the
 * file. The screens that need an id say so rather than showing an empty list
 * that looks like a clinic which has lost the records.
 */
struct NoPatientFileView: View {
    var body: some View {
        VStack(spacing: Tokens.Spacing.md) {
            Text(L10n.string("home.noPatientFile"))
                .multilineTextAlignment(.center)
        }
        .padding(Tokens.Spacing.xl)
    }
}

/**
 * The reference photograph's bytes, for the capture overlay.
 *
 * Nil whenever anything is missing — no reference, no link, a download that
 * failed. A capture with no guide is the normal case for the first photograph
 * of an area; a capture that refuses to open because the guide could not be
 * fetched would be worse than one without it.
 */
@MainActor
func referenceImage(for reference: ClinicalPhoto?, photos: PhotosAPI) async -> Data? {
    guard
        let reference,
        let link = try? await photos.link(photoId: reference.id),
        let url = URL(string: link.url),
        let (data, _) = try? await URLSession.shared.data(from: url)
    else { return nil }

    return data
}

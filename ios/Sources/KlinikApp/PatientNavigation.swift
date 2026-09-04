import SwiftUI
import KlinikAPI
import KlinikAppointmentsFeature
import KlinikComplicationsFeature
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
    let environment: AppEnvironment
    let patientId: String?
    let signOut: () async -> Void

    @State private var path: [PatientDestination] = []

    var body: some View {
        NavigationStack(path: $path) {
            HomeScreen(
                model: HomeModel(api: environment.me),
                emergency: EmergencyModel(
                    trigger: APIEmergencyTrigger(api: environment.emergency)
                ),
                onSelect: { action in
                    // The emergency action is not a destination: it arms the
                    // two-step confirmation in place. Pushing a screen would
                    // put a navigation animation between a patient and the
                    // button they just pressed.
                    if let destination = PatientHomeView.destination(for: action) {
                        path.append(destination)
                    }
                }
            )
            .navigationDestination(for: PatientDestination.self) { destination in
                screen(for: destination)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) { menu }
            }
        }
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
            Button(L10n.string("menu.photos")) { path.append(.photos) }
            Button(L10n.string("menu.measurements")) { path.append(.measurements) }
            Button(L10n.string("menu.followUp")) { path.append(.followUp) }
            Button(L10n.string("menu.labResults")) { path.append(.labResults) }
            Button(L10n.string("menu.complications")) { path.append(.complications) }
            Button(L10n.string("menu.appointments")) { path.append(.appointments) }
            Button(L10n.string("notification.settingsTitle")) { path.append(.notificationSettings) }

            Divider()

            Button(L10n.string("auth.signOut"), role: .destructive) {
                Task { await signOut() }
            }
        } label: {
            Label(L10n.string("common.more"), systemImage: "ellipsis.circle")
        }
    }

    @ViewBuilder
    private func screen(for destination: PatientDestination) -> some View {
        switch destination {
        case .messages:
            ChatScreen(
                model: ChatModel(api: environment.messaging) {
                    // A patient has exactly one conversation with the clinic,
                    // and the server decides which — asking for it by id here
                    // would let the client name someone else's.
                    try await environment.messaging.myConversation()
                }
            )

        case .documents:
            DocumentListView(
                model: DocumentsModel(
                    api: environment.documents,
                    resumable: environment.resumable,
                    // `.me`, never the file id: the staff path needs
                    // documents.read, which a patient must not have.
                    subject: .me
                ),
                pickFile: { await FilePicker.present() }
            )

        case .medications:
            MedicationsScreen(model: MedicationsModel(api: environment.medications))

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
            RecordMeasurementView(
                model: MeasurementsModel(
                    api: environment.measurements,
                    subject: .me,
                    // A reading a patient types is recorded as theirs. The
                    // server decides this too; sending `.nurse` from a patient
                    // build would put unverified numbers in a clinical record
                    // wearing a nurse's authority.
                    source: .patient
                ),
                onSaved: {}
            )

        case .followUp:
            FollowUpScreen(model: FollowUpModel(api: environment.followUp))

        case .labResults:
            LabTrendScreen(model: LabTrendModel(api: environment.lab, subject: .me))

        case .complications:
            MyComplicationsView(model: MyComplicationsModel(api: environment.complications))

        case .appointments:
            AppointmentsScreen(model: AppointmentsModel(api: environment.appointments))

        case .notificationSettings:
            NotificationSettingsScreen(
                model: NotificationSettingsModel(api: environment.notifications)
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

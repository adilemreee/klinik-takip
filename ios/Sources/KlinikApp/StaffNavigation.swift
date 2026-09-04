import SwiftUI
import KlinikAPI
import KlinikAppointmentsFeature
import KlinikComplicationsFeature
import KlinikCore
import KlinikDesign
import KlinikDocumentsFeature
import KlinikFollowUpFeature
import KlinikLabFeature
import KlinikMeasurementsFeature
import KlinikMessagingFeature
import KlinikNotificationsFeature
import KlinikPatientsFeature
import KlinikPhotosFeature

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
    case notificationSettings
}

/// The staff side of the app: the patient list and everything under a file.
@MainActor
struct StaffPatientsView: View {
    let environment: AppEnvironment
    let signOut: () async -> Void

    @State private var path: [StaffDestination] = []

    var body: some View {
        NavigationStack(path: $path) {
            PatientListView(
                model: PatientListModel(api: environment.patients),
                onSelect: { patient in
                    path.append(.patient(id: patient.id, name: patient.fullName))
                }
            )
            .navigationTitle(L10n.string("menu.patients"))
            .navigationDestination(for: StaffDestination.self) { destination in
                screen(for: destination)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) { menu }
            }
        }
    }

    private var menu: some View {
        Menu {
            Button(L10n.string("menu.complicationQueue")) { path.append(.complicationQueue) }
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
    private func screen(for destination: StaffDestination) -> some View {
        switch destination {
        case .patient(let id, let name):
            PatientFileView(environment: environment, patientId: id, name: name) { next in
                path.append(next)
            }

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
                pickFile: { await FilePicker.present() }
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
                canUseTemplates: true
            )

        case .appointments(let patientId):
            // Staff confirm a requested slot; a patient only asks and cancels.
            AppointmentsScreen(
                model: AppointmentsModel(api: environment.appointments, patientId: patientId),
                canConfirm: true
            )

        case .complicationQueue:
            ComplicationQueueView(model: ComplicationQueueModel(api: environment.complications))

        case .notificationSettings:
            NotificationSettingsScreen(
                model: NotificationSettingsModel(api: environment.notifications)
            )
        }
    }
}

/**
 * One patient's file, and the way into everything recorded about them.
 *
 * The detail screen stays what it was — a summary. The list below it is
 * navigation, kept here rather than inside the feature module so that module
 * has no opinion about what else the app contains.
 */
@MainActor
struct PatientFileView: View {
    @Environment(\.colorScheme) private var scheme

    let environment: AppEnvironment
    let patientId: String
    let name: String
    let go: (StaffDestination) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                PatientDetailView(
                    model: PatientDetailModel(api: environment.patients, patientId: patientId)
                )

                Divider()

                ForEach(sections, id: \.title) { section in
                    Button(section.title) { go(section.destination) }
                        .font(Tokens.Typography.bodyRelative)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget, alignment: .leading)
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(name)
    }

    private var sections: [(title: String, destination: StaffDestination)] {
        [
            (L10n.string("menu.messages"), .conversation(patientId: patientId)),
            (L10n.string("menu.measurements"), .measurements(patientId: patientId)),
            (L10n.string("menu.documents"), .documents(patientId: patientId)),
            (L10n.string("menu.labReview"), .labReview(patientId: patientId)),
            (L10n.string("menu.labResults"), .labTrend(patientId: patientId)),
            (L10n.string("menu.photos"), .photos(patientId: patientId)),
            (L10n.string("menu.followUp"), .followUp(patientId: patientId)),
            (L10n.string("menu.appointments"), .appointments(patientId: patientId)),
        ]
    }
}

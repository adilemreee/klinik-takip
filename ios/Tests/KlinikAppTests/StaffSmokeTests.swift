import XCTest
import KlinikAPI
import KlinikAppointmentsFeature
import KlinikComplicationsFeature
import KlinikCore
import KlinikDocumentsFeature
import KlinikFollowUpFeature
import KlinikLabFeature
import KlinikMeasurementsFeature
import KlinikMessagingFeature
import KlinikPatientsFeature
import KlinikPhotosFeature
@testable import KlinikApp

/**
 * The staff side against a real server, opt-in.
 *
 * Written because the patient side had this and the staff side did not: every
 * staff screen had been checked with curl, and curl does not run the client's
 * decoder, its models, or its routing. That gap is exactly where a screen can
 * be broken while the endpoint behind it is fine.
 *
 *     KLINIK_SMOKE_BASE_URL=… KLINIK_STAFF_IDENTIFIER=… \
 *     KLINIK_STAFF_PASSWORD=… KLINIK_STAFF_TOTP=… \
 *     swift test --filter StaffSmokeTests
 */
final class StaffSmokeTests: XCTestCase {
    private struct Config {
        let baseURL: URL
        let identifier: String
        let password: String
        let totp: String
    }

    private func configuration() throws -> Config {
        let environment = ProcessInfo.processInfo.environment

        guard
            let raw = environment["KLINIK_SMOKE_BASE_URL"],
            let baseURL = URL(string: raw),
            let identifier = environment["KLINIK_STAFF_IDENTIFIER"],
            let password = environment["KLINIK_STAFF_PASSWORD"],
            let totp = environment["KLINIK_STAFF_TOTP"]
        else {
            throw XCTSkip("Set KLINIK_SMOKE_BASE_URL and the KLINIK_STAFF_* variables")
        }

        return Config(baseURL: baseURL, identifier: identifier, password: password, totp: totp)
    }

    @MainActor
    func testEveryStaffScreenLoads() async throws {
        let config = try configuration()
        let environment = AppEnvironment(baseURL: config.baseURL)

        let response = try await environment.auth.login(
            LoginRequest(
                identifier: config.identifier,
                password: config.password,
                totpCode: config.totp
            )
        )

        XCTAssertEqual(response.status, .ok, "staff sign-in did not complete")
        try await environment.session.signIn(with: try XCTUnwrap(response.tokens()))

        let identity = try await environment.me.identity()
        XCTAssertTrue(identity.isStaff)

        // The route the shell would take.
        let route = Root.route(for: RootInput(session: .signedIn, identity: identity))
        XCTAssertEqual(route, .staffHome(role: identity.role))

        // The list, through the model the screen actually uses.
        let list = PatientListModel(api: environment.patients)
        await list.search(query: "")
        let listed = await list.currentState()

        assertNotFailed(listed.phase, "patient list")
        let patient = try XCTUnwrap(listed.patients.first, "the list came back empty")

        // And everything reachable from one patient's file.
        let detail = PatientDetailModel(api: environment.patients, patientId: patient.id)
        await detail.load()
        assertNotFailed(await detail.currentState().phase, "patient detail")

        let chat = ChatModel(api: environment.messaging) {
            try await environment.messaging.conversation(patientId: patient.id)
        }
        await chat.load()
        assertNotFailed(await chat.currentState().phase, "conversation")

        let measurements = MeasurementsModel(
            api: environment.measurements,
            subject: .patient(id: patient.id),
            source: .nurse
        )
        await measurements.load()
        assertNotFailed(await measurements.currentState().phase, "measurements")

        let documents = DocumentsModel(
            api: environment.documents,
            resumable: environment.resumable,
            subject: .patient(id: patient.id)
        )
        await documents.load()
        assertNotFailed(await documents.currentState().phase, "documents")

        let review = LabReviewModel(api: environment.lab, patientId: patient.id)
        await review.load()
        assertNotFailed(await review.currentState().phase, "lab review")

        let trends = LabTrendModel(api: environment.lab, subject: .patient(id: patient.id))
        await trends.load()
        assertNotFailed(await trends.currentState().phase, "lab trends")

        let photos = PhotoGalleryModel(api: environment.photos, subject: .patient(id: patient.id))
        await photos.load()
        assertNotFailed(await photos.currentState().phase, "photos")

        let followUp = FollowUpModel(api: environment.followUp, patientId: patient.id)
        await followUp.refresh()
        assertNotFailed(await followUp.currentState().phase, "follow-up")

        let appointments = AppointmentsModel(api: environment.appointments, patientId: patient.id)
        await appointments.refresh()
        assertNotFailed(await appointments.currentState().phase, "appointments")

        let queue = ComplicationQueueModel(api: environment.complications)
        await queue.load()
        assertNotFailed(await queue.currentState().phase, "complication queue")
    }

    private func assertNotFailed(_ phase: Any, _ screen: String) {
        let described = String(describing: phase)

        XCTAssertFalse(
            described.hasPrefix("failed"),
            "\(screen) failed against the real server: \(described)"
        )
    }
}

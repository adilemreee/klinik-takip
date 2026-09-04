import XCTest
import KlinikAPI
import KlinikComplicationsFeature
import KlinikCore
import KlinikDocumentsFeature
import KlinikFollowUpFeature
import KlinikHomeFeature
import KlinikLabFeature
import KlinikMeasurementsFeature
import KlinikMedicationsFeature
import KlinikMessagingFeature
import KlinikNotificationsFeature
import KlinikPhotosFeature
@testable import KlinikApp

/**
 * The client stack against a real server, opt-in.
 *
 * Skipped unless `KLINIK_SMOKE_BASE_URL` is set, so the ordinary test run stays
 * hermetic and fast. It exists because everything else about the networking is
 * tested against a fake transport, and a fake transport cannot tell you that
 * the paths are wrong, the JSON does not decode, or the token never reaches the
 * header — which are exactly the failures that only appear against the real
 * thing.
 *
 * Run it against a tunnel to staging:
 *
 *     ssh -N -L 18123:127.0.0.1:8123 <server>
 *     KLINIK_SMOKE_BASE_URL=http://127.0.0.1:18123 \
 *     KLINIK_SMOKE_IDENTIFIER=… KLINIK_SMOKE_PASSWORD=… swift test --filter LiveSmokeTests
 */
final class LiveSmokeTests: XCTestCase {
    private struct Config {
        let baseURL: URL
        let identifier: String
        let password: String
    }

    private func configuration() throws -> Config {
        let environment = ProcessInfo.processInfo.environment

        guard
            let raw = environment["KLINIK_SMOKE_BASE_URL"],
            let baseURL = URL(string: raw),
            let identifier = environment["KLINIK_SMOKE_IDENTIFIER"],
            let password = environment["KLINIK_SMOKE_PASSWORD"]
        else {
            throw XCTSkip("Set KLINIK_SMOKE_BASE_URL, _IDENTIFIER and _PASSWORD to run this")
        }

        return Config(baseURL: baseURL, identifier: identifier, password: password)
    }

    func testSignsInAndLearnsWhoItIs() async throws {
        let config = try configuration()
        let transport = URLSessionTransport()
        // In memory: a smoke test must not write to the developer's keychain.
        let session = SessionManager(
            store: InMemoryTokenStore(),
            refresher: HTTPTokenRefresher(baseURL: config.baseURL, transport: transport)
        )
        let client = APIClient(
            configuration: APIConfiguration(baseURL: config.baseURL),
            transport: transport,
            session: session
        )

        // Sign in exactly as the app does.
        let response = try await AuthAPI(client: client).login(
            LoginRequest(identifier: config.identifier, password: config.password)
        )

        XCTAssertEqual(response.status, .ok, "a patient account should not need a second factor")

        let access = try XCTUnwrap(response.accessToken)
        let refresh = try XCTUnwrap(response.refreshToken)
        let expiresIn = try XCTUnwrap(response.expiresIn)

        try await session.signIn(
            with: SessionTokens(
                accessToken: access,
                refreshToken: refresh,
                expiresAt: Date().addingTimeInterval(TimeInterval(expiresIn))
            )
        )

        // The app's first question, and the one the shell routes on.
        let identity = try await MeAPI(client: client).identity()

        XCTAssertEqual(identity.role, .patient)
        XCTAssertFalse(identity.isStaff)
        XCTAssertFalse(identity.displayName.isEmpty)

        // And the route the shell would take from it.
        let route = Root.route(for: RootInput(session: .signedIn, identity: identity))
        XCTAssertEqual(route, .patientHome(patientId: identity.patientId))
    }

    /**
     * Every screen the patient shell can reach, loaded against the real server.
     *
     * The risk this covers is specific and not covered anywhere else: a screen
     * that was wired into navigation but whose model fails on its first load —
     * a wrong path, a payload that will not decode, a field the server stopped
     * sending. Unit tests use a fake transport and cannot see any of it, and
     * the failure only appears when somebody taps the tile.
     *
     * Each model is asked for its state and the state is required not to be a
     * failure. An *empty* result is fine: a fresh test account genuinely has no
     * documents.
     */
    @MainActor
    func testEveryPatientScreenLoads() async throws {
        let config = try configuration()
        let environment = AppEnvironment(baseURL: config.baseURL)

        let response = try await environment.auth.login(
            LoginRequest(identifier: config.identifier, password: config.password)
        )
        let tokens = try XCTUnwrap(response.tokens())
        try await environment.session.signIn(with: tokens)

        let identity = try await environment.me.identity()
        _ = try XCTUnwrap(identity.patientId, "the smoke account needs a linked file")

        // Home, and the four tiles that lead somewhere.
        let home = HomeModel(api: environment.me)
        await home.load()
        assertNotFailed(await home.currentState().phase, "home")

        let chat = ChatModel(api: environment.messaging) {
            try await environment.messaging.myConversation()
        }
        await chat.load()
        assertNotFailed(await chat.currentState().phase, "messages")

        let documents = DocumentsModel(
            api: environment.documents,
            resumable: environment.resumable,
            subject: .me
        )
        await documents.load()
        assertNotFailed(await documents.currentState().phase, "documents")

        let medications = MedicationsModel(api: environment.medications)
        await medications.refresh()
        assertNotFailed(await medications.currentState().phase, "medications")

        let photos = PhotoGalleryModel(api: environment.photos, subject: .me)
        await photos.load()
        assertNotFailed(await photos.currentState().phase, "photos")

        // And everything behind the overflow menu.
        let measurements = MeasurementsModel(
            api: environment.measurements,
            subject: .me,
            source: .patient
        )
        await measurements.load()
        assertNotFailed(await measurements.currentState().phase, "measurements")

        let followUp = FollowUpModel(api: environment.followUp)
        await followUp.refresh()
        assertNotFailed(await followUp.currentState().phase, "follow-up")

        let labs = LabTrendModel(api: environment.lab, subject: .me)
        await labs.load()
        assertNotFailed(await labs.currentState().phase, "lab results")

        let complications = MyComplicationsModel(api: environment.complications)
        await complications.load()
        assertNotFailed(await complications.currentState().phase, "complications")

        let notifications = NotificationSettingsModel(api: environment.notifications)
        await notifications.load()
        assertNotFailed(await notifications.currentState().phase, "notification settings")
    }

    /// A phase describing a failure, with the message the user would have read.
    private func assertNotFailed(_ phase: Any, _ screen: String) {
        let described = String(describing: phase)

        XCTAssertFalse(
            described.hasPrefix("failed"),
            "\(screen) failed to load against the real server: \(described)"
        )
    }
}

import XCTest
import KlinikAPI
import KlinikCore
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
}

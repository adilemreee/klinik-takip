import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikNotificationsFeature

private actor RecordingTransport: HTTPTransport {
    private var bodies: [String: (Int, String)]
    private let delays: [String: Duration]
    private(set) var calls: [String] = []
    private(set) var sent: [Data] = []

    init(bodies: [String: (Int, String)], delays: [String: Duration] = [:]) {
        self.bodies = bodies
        self.delays = delays
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        calls.append(key)
        if let body = request.httpBody { sent.append(body) }

        if let delay = delays[key] {
            try? await Task.sleep(for: delay)
        }

        guard let (status, body) = bodies[key] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func made() -> [String] { calls }
    func bodiesSent() -> [Data] { sent }
}

private struct FailingTransport: HTTPTransport {
    let error: APIError
    func send(_ request: URLRequest) async throws -> HTTPResponse { throw error }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

private func preference(
    type: String,
    channel: String = "PUSH",
    enabled: Bool = true,
    quiet: (String, String)? = nil
) -> String {
    """
    {"type":"\(type)","channel":"\(channel)","enabled":\(enabled),
     "quietHoursStart":\(quiet.map { "\"\($0.0)\"" } ?? "null"),
     "quietHoursEnd":\(quiet.map { "\"\($0.1)\"" } ?? "null"),
     "timezone":"Europe/Istanbul"}
    """
}

/**
 * The notification settings screen.
 *
 * The rule that matters is "absent means on": someone who never opened this
 * screen still hears that their results are ready. It has to be the same rule
 * the server applies, or the switch shows one thing and the clinic does another.
 */
final class NotificationSettingsModelTests: XCTestCase {
    private func model(_ transport: HTTPTransport) async -> NotificationSettingsModel {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        try? await session.signIn(
            with: SessionTokens(
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: Date().addingTimeInterval(900)
            )
        )
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )
        return NotificationSettingsModel(api: NotificationsAPI(client: client))
    }

    private func bodies(
        preferences: String = "[]",
        history: String = "[]",
        extra: [String: (Int, String)] = [:]
    ) -> [String: (Int, String)] {
        var map: [String: (Int, String)] = [
            "GET /me/notifications/preferences": (200, preferences),
            "GET /me/notifications": (200, history),
        ]
        for (key, value) in extra { map[key] = value }
        return map
    }

    func testLoadsPreferencesAndHistory() async {
        let settings = await model(
            RecordingTransport(
                bodies: bodies(
                    preferences: "[\(preference(type: "lab.ready", enabled: false))]",
                    history: """
                    [{"id":"n1","type":"lab.ready","title":"Hazır","body":"…",
                      "channel":"PUSH","status":"FAILED","failureReason":"device unreachable",
                      "fallbackForId":null,"sentAt":null,"readAt":null,
                      "createdAt":"2026-03-01T08:00:00.000Z"}]
                    """
                )
            )
        )

        await settings.load()

        let state = await settings.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.preferences.count, 1)
        XCTAssertEqual(state.history.first?.status, .failed)
    }

    /// Someone who never opened this screen still gets told their results are ready.
    func testTreatsAnAbsentPreferenceAsOn() async {
        let settings = await model(RecordingTransport(bodies: bodies()))

        await settings.load()

        let state = await settings.currentState()

        XCTAssertTrue(state.isEnabled(.labReady, .push))
    }

    func testReportsAStoredFalseAsOff() async {
        let settings = await model(
            RecordingTransport(
                bodies: bodies(preferences: "[\(preference(type: "lab.ready", enabled: false))]")
            )
        )

        await settings.load()

        let state = await settings.currentState()

        XCTAssertFalse(state.isEnabled(.labReady, .push))
        // A different channel of the same type is untouched.
        XCTAssertTrue(state.isEnabled(.labReady, .sms))
    }

    func testSavesASwitchAndKeepsWhatTheServerReturned() async {
        let settings = await model(
            RecordingTransport(
                bodies: bodies(
                    extra: [
                        "PUT /me/notifications/preferences": (
                            200, preference(type: "lab.ready", enabled: false)
                        ),
                    ]
                )
            )
        )

        await settings.load()
        let saved = await settings.set(.labReady, channel: .push, enabled: false)

        let state = await settings.currentState()

        XCTAssertTrue(saved)
        XCTAssertFalse(state.isEnabled(.labReady, .push))
    }

    /**
     * A switch that stays flipped after the server refused is a setting the
     * person believes they made.
     */
    func testLeavesTheSwitchAloneWhenSavingFails() async {
        let settings = await model(
            RecordingTransport(
                bodies: bodies(
                    extra: [
                        "PUT /me/notifications/preferences": (
                            400, "{\"statusCode\":400,\"message\":\"Bad request\"}"
                        ),
                    ]
                )
            )
        )

        await settings.load()
        let saved = await settings.set(.labReady, channel: .push, enabled: false)

        let state = await settings.currentState()

        XCTAssertFalse(saved)
        XCTAssertTrue(state.isEnabled(.labReady, .push))
        XCTAssertEqual(state.error, "Bad request")
    }

    /// Turning a type off must not silently drop the quiet hours it had.
    func testKeepsQuietHoursWhenTogglingATypeOff() async throws {
        let transport = RecordingTransport(
            bodies: bodies(
                preferences: "[\(preference(type: "lab.ready", quiet: ("22:00", "08:00")))]",
                extra: [
                    "PUT /me/notifications/preferences": (
                        200, preference(type: "lab.ready", enabled: false, quiet: ("22:00", "08:00"))
                    ),
                ]
            )
        )
        let settings = await model(transport)

        await settings.load()
        await settings.set(.labReady, channel: .push, enabled: false)

        let sent = await transport.bodiesSent()
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: sent.last!) as? [String: Any]
        )

        XCTAssertEqual(json["quietHoursStart"] as? String, "22:00")
        XCTAssertEqual(json["quietHoursEnd"] as? String, "08:00")
    }

    func testSavesQuietHours() async {
        let settings = await model(
            RecordingTransport(
                bodies: bodies(
                    extra: [
                        "PUT /me/notifications/preferences": (
                            200, preference(type: "lab.ready", quiet: ("22:00", "08:00"))
                        ),
                    ]
                )
            )
        )

        await settings.load()
        let saved = await settings.setQuietHours(.labReady, start: "22:00", end: "08:00")

        let quiet = await settings.currentState().quietHours(.labReady)

        XCTAssertTrue(saved)
        XCTAssertEqual(quiet?.start, "22:00")
    }

    /// A double tap must not send two conflicting saves.
    func testRefusesASecondSaveWhileOneIsInFlight() async {
        let transport = RecordingTransport(
            bodies: bodies(
                extra: [
                    "PUT /me/notifications/preferences": (
                        200, preference(type: "lab.ready", enabled: false)
                    ),
                ]
            ),
            delays: ["PUT /me/notifications/preferences": .milliseconds(200)]
        )
        let settings = await model(transport)

        await settings.load()

        async let first = settings.set(.labReady, channel: .push, enabled: false)
        async let second = settings.set(.labReady, channel: .push, enabled: true)

        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
    }

    /**
     * A patient who was never reached should be able to see the clinic tried,
     * and which attempt stood in for which.
     */
    func testShowsTheFallbackChain() async {
        let settings = await model(
            RecordingTransport(
                bodies: bodies(
                    history: """
                    [{"id":"n2","type":"lab.critical","title":"Kritik","body":"…",
                      "channel":"SMS","status":"SENT","failureReason":null,
                      "fallbackForId":"n1","sentAt":"2026-03-01T08:01:00.000Z",
                      "readAt":null,"createdAt":"2026-03-01T08:01:00.000Z"}]
                    """
                )
            )
        )

        await settings.load()

        let history = await settings.currentState().history

        XCTAssertTrue(history[0].isFallback)
        XCTAssertEqual(history[0].channel, .sms)
    }

    func testReportsAFailureToLoad() async {
        let settings = await model(FailingTransport(error: .offline))

        await settings.load()

        let phase = await settings.currentState().phase

        guard case .failed = phase else {
            return XCTFail("expected a failure state")
        }
    }

    /// Registering is best-effort: a device that could not register must not
    /// stop the person using the app.
    func testDeviceRegistrationDoesNotThrow() async {
        let settings = await model(FailingTransport(error: .offline))

        await settings.registerDevice(token: "tok", deviceId: "dev")
        await settings.forgetDevice(token: "tok")
    }
}

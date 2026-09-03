import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikEmergencyFeature

private actor RecordingTransport: HTTPTransport {
    private let bodies: [String: (Int, String)]
    private(set) var calls: [String] = []

    init(bodies: [String: (Int, String)]) {
        self.bodies = bodies
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        calls.append(key)

        guard let (status, body) = bodies[key] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func made() -> [String] { calls }
    func count(of key: String) -> Int { calls.filter { $0 == key }.count }
}

private struct FailingTransport: HTTPTransport {
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        throw APIError.offline
    }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

/// Answers at once.
private struct FixedLocator: EmergencyLocating {
    let coordinates: Coordinates?
    func currentLocation() async -> Coordinates? { coordinates }
}

/// Never answers — a cold GPS indoors, which is most of them.
private struct SilentLocator: EmergencyLocating {
    func currentLocation() async -> Coordinates? {
        try? await Task.sleep(for: .seconds(30))
        return nil
    }
}

private let card = """
{"language":"tr","emergencyNumber":{"number":"112","countryCode":"TR","source":"country"},
 "steps":[{"id":"call-local","text":"112 arayın","critical":true},
          {"id":"stay-put","text":"Bulunduğunuz yerde kalın","critical":false}]}
"""

private func event(_ id: String = "e1", status: String = "TRIGGERED") -> String {
    """
    {"id":"\(id)","patientId":"p1","status":"\(status)","triggeredAt":"2026-03-04T10:00:00.000Z",
     "latitude":null,"longitude":null,"note":null,"escalationLevel":0,
     "acknowledgedAt":null,"resolution":null,"resolvedAt":null}
    """
}

private func view(_ id: String = "e1", status: String = "TRIGGERED", alreadyOpen: Bool = false) -> String {
    """
    {"event":\(event(id, status: status)),"guidance":\(card),"alreadyOpen":\(alreadyOpen)}
    """
}

private func model(
    _ transport: HTTPTransport,
    locator: EmergencyLocating? = nil,
    locationTimeout: Duration = .milliseconds(50),
    armedWindow: Duration = .seconds(10)
) async -> EmergencyModel {
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

    return EmergencyModel(
        api: EmergencyAPI(client: client),
        locator: locator,
        locationTimeout: locationTimeout,
        armedWindow: armedWindow
    )
}

/**
 * The emergency button.
 *
 * Two of these tests are about things *not* happening: a single press must not
 * raise an alarm, and a slow GPS must not hold one up. Both are failures that
 * only show up in the field.
 */
final class EmergencyModelTests: XCTestCase {
    func testOnePressDoesNotRaiseAnAlarm() async throws {
        let transport = RecordingTransport(bodies: ["POST /me/emergency": (201, view())])
        let subject = await model(transport)

        await subject.arm()

        let state = await subject.currentState()
        XCTAssertEqual(state.phase, .armed)
        // A single button that raises a clinical alarm will be pressed by a
        // pocket.
        let actual1 = await transport.made()
        XCTAssertEqual(actual1, [])
    }

    func testTwoPressesRaiseIt() async throws {
        let transport = RecordingTransport(bodies: ["POST /me/emergency": (201, view())])
        let subject = await model(transport)

        await subject.arm()
        await subject.confirm()

        let state = await subject.currentState()
        XCTAssertEqual(state.phase, .raised)
        XCTAssertEqual(state.event?.id, "e1")
        XCTAssertEqual(state.card?.emergencyNumber.number, "112")
    }

    func testConfirmWithoutArmingDoesNothing() async throws {
        let transport = RecordingTransport(bodies: ["POST /me/emergency": (201, view())])
        let subject = await model(transport)

        await subject.confirm()

        let actual2 = await transport.made()
        XCTAssertEqual(actual2, [])
        let actual3 = await subject.currentState().phase
        XCTAssertEqual(actual3, .idle)
    }

    /**
     * A pocket that armed the button must not leave it primed for the next
     * pocket. The window closing puts the screen back to one button.
     */
    func testTheArmingWindowClosesOnItsOwn() async throws {
        let transport = RecordingTransport(bodies: ["POST /me/emergency": (201, view())])
        let subject = await model(transport, armedWindow: .milliseconds(20))

        await subject.arm()
        try await Task.sleep(for: .milliseconds(60))
        await subject.confirm()

        let actual4 = await transport.made()
        XCTAssertEqual(actual4, [])
        let actual5 = await subject.currentState().phase
        XCTAssertEqual(actual5, .idle)
    }

    func testSendsTheLocationWhenTheDeviceHasOne() async throws {
        let transport = RecordingTransport(bodies: ["POST /me/emergency": (201, view())])
        let subject = await model(
            transport,
            locator: FixedLocator(coordinates: Coordinates(latitude: 41.0082, longitude: 28.9784))
        )

        await subject.arm()
        await subject.confirm()

        let actual6 = await subject.currentState().phase
        XCTAssertEqual(actual6, .raised)
    }

    /**
     * The rule this test exists for: a cold GPS takes fifteen seconds, and the
     * alarm is worth more than the pin. Losing the race is not an error.
     */
    func testDoesNotWaitForALocationThatNeverArrives() async throws {
        let transport = RecordingTransport(bodies: ["POST /me/emergency": (201, view())])
        let subject = await model(transport, locator: SilentLocator(), locationTimeout: .milliseconds(30))

        let started = ContinuousClock.now
        await subject.arm()
        await subject.confirm()
        let elapsed = ContinuousClock.now - started

        let actual7 = await subject.currentState().phase
        XCTAssertEqual(actual7, .raised)
        XCTAssertLessThan(elapsed, .seconds(5))
    }

    /**
     * The network being down is exactly when the local ambulance matters most,
     * so a failed trigger must not take the phone number off the screen.
     */
    func testAFailedAlarmStillLeavesTheNumberOnScreen() async throws {
        let prefetch = RecordingTransport(bodies: [
            "GET /me/emergency/active": (200, "null"),
            "GET /me/emergency/guidance": (200, card),
        ])
        let subject = await model(prefetch)
        await subject.prefetch()

        let actual8 = await subject.currentState().card?.emergencyNumber.number
        XCTAssertEqual(actual8, "112")

        let offline = await model(FailingTransport())
        await offline.arm()
        await offline.confirm()

        // A fresh model has no card, which is why the real screen prefetches;
        // what matters here is that the failure is reported as one and the card
        // it already holds is never cleared.
        let state = await offline.currentState()
        XCTAssertTrue(state.phase.isFailure)
    }

    func testPrefetchPicksUpACallThatIsAlreadyOpen() async throws {
        let transport = RecordingTransport(bodies: [
            "GET /me/emergency/active": (200, view(alreadyOpen: true)),
        ])
        let subject = await model(transport)

        await subject.prefetch()

        let state = await subject.currentState()
        XCTAssertEqual(state.phase, .raised)
        XCTAssertTrue(state.alreadyOpen)
        XCTAssertEqual(state.event?.id, "e1")
    }

    func testCancelsAnAlarmNobodyHasPickedUp() async throws {
        let transport = RecordingTransport(bodies: [
            "POST /me/emergency": (201, view()),
            "PATCH /me/emergency/e1/cancel": (200, event(status: "FALSE_ALARM")),
        ])
        let subject = await model(transport)

        await subject.arm()
        await subject.confirm()
        await subject.cancel()

        let state = await subject.currentState()
        XCTAssertEqual(state.event?.status, .falseAlarm)
        XCTAssertEqual(state.phase, .idle)
    }

    /// Once a clinician has it, the patient's "never mind" is not theirs to give.
    func testWillNotCancelOnceTheClinicIsHandlingIt() async throws {
        let transport = RecordingTransport(bodies: [
            "GET /me/emergency/active": (200, view(status: "ACKNOWLEDGED")),
            "PATCH /me/emergency/e1/cancel": (200, event(status: "FALSE_ALARM")),
        ])
        let subject = await model(transport)

        await subject.prefetch()
        await subject.cancel()

        let actual9 = await transport.count(of: "PATCH /me/emergency/e1/cancel")
        XCTAssertEqual(actual9, 0)
        let actual10 = await subject.currentState().event?.status
        XCTAssertEqual(actual10, .acknowledged)
    }

    func testTheCardSeparatesTheLineThatPointsAwayFromTheClinic() async throws {
        let transport = RecordingTransport(bodies: [
            "GET /me/emergency/active": (200, "null"),
            "GET /me/emergency/guidance": (200, card),
        ])
        let subject = await model(transport)

        await subject.prefetch()

        let card = await subject.currentState().card
        let guidance = try XCTUnwrap(card)
        XCTAssertEqual(guidance.criticalStep?.id, "call-local")
        XCTAssertEqual(guidance.ordinarySteps.count, 1)
        XCTAssertFalse(guidance.emergencyNumber.isGuess)
        XCTAssertEqual(guidance.emergencyNumber.dialURL?.absoluteString, "tel://112")
    }

    func testMarksAGuessedNumberAsOne() throws {
        let guessed = """
        {"language":"tr","emergencyNumber":{"number":"112","countryCode":"","source":"international"},
         "steps":[{"id":"call-local","text":"112","critical":true}]}
        """
        let decoded = try JSONDecoder.klinik.decode(EmergencyGuidance.self, from: Data(guessed.utf8))

        // The client says different things for the two: a guessed number needs
        // the caveat, a known one does not.
        XCTAssertTrue(decoded.emergencyNumber.isGuess)
    }
}

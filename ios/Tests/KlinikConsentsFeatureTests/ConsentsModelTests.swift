import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikConsentsFeature

private actor ScriptedTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private(set) var requests: [URLRequest] = []

    init(_ responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)

        guard !responses.isEmpty else { return HTTPResponse(status: 200, body: Data("[]".utf8)) }

        return responses.removeFirst()
    }

    func sent() -> [URLRequest] { requests }
}

private actor NeverRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unauthorized(ErrorResponse(statusCode: 401, message: "not signed in"))
    }
}

/**
 * Giving and withdrawing consent (KVKK).
 *
 * The rules under test are legal ones, and each is a way the screen could look
 * correct while being wrong.
 */
final class ConsentsModelTests: XCTestCase {
    private func make(
        _ responses: [HTTPResponse]
    ) async throws -> (ConsentsModel, ScriptedTransport) {
        let transport = ScriptedTransport(responses)
        let session = SessionManager(store: InMemoryTokenStore(), refresher: NeverRefresher())

        try await session.signIn(
            with: SessionTokens(
                accessToken: "a",
                refreshToken: "r",
                expiresAt: Date().addingTimeInterval(900)
            )
        )

        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )

        return (ConsentsModel(api: ConsentsAPI(client: client), version: 3), transport)
    }

    private func consent(
        _ type: String,
        active: Bool = true,
        revoked: String? = nil
    ) -> String {
        """
        {"id":"c-\(type)","patientId":"p1","type":"\(type)","version":3,
         "signedAt":"2026-09-01T10:00:00.000Z",
         "revokedAt":\(revoked.map { "\"\($0)\"" } ?? "null"),"active":\(active)}
        """
    }

    func testTheAskableSetExcludesWhatMustNotBeAsked() {
        // Treatment is signed at the clinic. Data processing rests on the
        // health-care ground in law, and Board decision 2026/347 forbids
        // putting a consent text in front of somebody where it applies —
        // asking suggests a refusal is possible when refusing costs them their
        // treatment, which makes the consent void.
        XCTAssertEqual(ConsentType.askable, [.photoUsage, .marketing])
        XCTAssertFalse(ConsentType.askable.contains(.dataProcessing))
        XCTAssertFalse(ConsentType.askable.contains(.treatment))
    }

    func testRefusesToSendAConsentThatMustNotBeAsked() async throws {
        // The server refuses it too. Both, because a client that sends it is a
        // client somebody could point at a laxer server.
        let (model, transport) = try await make([])

        let sent = await model.give(.dataProcessing)

        XCTAssertFalse(sent)
        let requests = await transport.sent()
        XCTAssertTrue(requests.isEmpty, "nothing should have been sent")
    }

    func testSendsTheVersionThatWasAgreedTo() async throws {
        // "They agreed" names nothing without it, and a text changed later must
        // not silently inherit agreement to the old one.
        let (model, transport) = try await make([
            HTTPResponse(status: 201, body: Data(consent("PHOTO_USAGE").utf8)),
            HTTPResponse(status: 200, body: Data("[\(consent("PHOTO_USAGE"))]".utf8)),
        ])

        await model.give(.photoUsage)

        let requests = await transport.sent()
        let body = try XCTUnwrap(requests.first?.httpBody)
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: body) as? [String: Any]
        )

        XCTAssertEqual(json["version"] as? Int, 3)
        XCTAssertEqual(json["type"] as? String, "PHOTO_USAGE")
    }

    func testAWithdrawnConsentIsNotActiveButIsStillThere() async throws {
        // Forward-only: proving a consent existed while it was relied on is the
        // controller's burden, and a row that vanished proves nothing.
        let (model, _) = try await make([
            HTTPResponse(
                status: 200,
                body: Data(
                    "[\(consent("MARKETING", active: false, revoked: "2026-09-03T08:00:00.000Z"))]".utf8
                )
            ),
        ])

        await model.load()
        let state = await model.currentState()

        XCTAssertNil(state.active(.marketing), "a withdrawn consent is not in force")
        XCTAssertNotNil(state.latest(.marketing), "but the record is still there")
        XCTAssertNotNil(state.latest(.marketing)?.revokedAt)
    }

    func testWithdrawingSomethingNeverGivenDoesNothing() async throws {
        let (model, transport) = try await make([
            HTTPResponse(status: 200, body: Data("[]".utf8)),
        ])

        await model.load()
        let withdrawn = await model.withdraw(.photoUsage)

        XCTAssertFalse(withdrawn)
        // One request: the load. No delete for a consent that does not exist.
        let requests = await transport.sent()
        XCTAssertEqual(requests.count, 1)
    }

    func testANoPatientFileAccountGetsItsOwnState() async throws {
        // An invitation creates the account before the clinic links a file.
        // Not a failure to retry — there is nothing to fetch yet.
        let (model, _) = try await make([
            HTTPResponse(status: 404, body: Data(#"{"statusCode":404}"#.utf8)),
        ])

        await model.load()
        let state = await model.currentState()

        XCTAssertEqual(state.phase, .notFound)
    }
}

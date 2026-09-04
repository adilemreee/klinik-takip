import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikPatientsFeature

private actor ScriptedTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private(set) var requests: [URLRequest] = []

    init(_ responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.isEmpty ? HTTPResponse(status: 500, body: Data()) : responses.removeFirst()
    }

    func sent() -> [URLRequest] { requests }
}

private actor NeverRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unauthorized(ErrorResponse(statusCode: 401, message: "no"))
    }
}

/// Opening a patient file.
final class NewPatientModelTests: XCTestCase {
    private func make(_ responses: [HTTPResponse]) async throws -> (NewPatientModel, ScriptedTransport) {
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

        return (NewPatientModel(api: PatientsAPI(client: client)), transport)
    }

    /// What the server actually sends: a full ISO 8601 timestamp, even for a
    /// column that is a date. A bare "1988-03-12" is not something the client
    /// parses, and a fixture that used one would test the wrong contract.
    private let created = """
    {"id":"p1","mrn":"2026-K7RMPX","firstName":"Ayşe","lastName":"Yılmaz",
     "birthDate":"1988-03-12T00:00:00.000Z","sex":"FEMALE","country":"TR","city":"İstanbul",
     "preferredLanguage":"tr","status":"LEAD","createdAt":"2026-09-05T10:00:00.000Z"}
    """

    func testRefusesABlankNameBeforeSendingAnything() async throws {
        // A nurse who fills a form, waits, and is then told the name is
        // missing has been made to wait for something the screen knew.
        let (model, transport) = try await make([])

        let saved = await model.create(
            firstName: "  ",
            lastName: "Yılmaz",
            birthDate: Date(),
            sex: "FEMALE",
            country: "TR",
            city: nil,
            referralSource: nil
        )

        XCTAssertFalse(saved)
        let requests = await transport.sent()
        XCTAssertTrue(requests.isEmpty)
    }

    func testRefusesACountryCodeThatIsNotTwoLetters() async throws {
        // The server drives language and discharge advice off this, and a wrong
        // code sends somebody the wrong emergency number.
        for bad in ["T", "TUR", "12", ""] {
            XCTAssertNotNil(
                NewPatientModel.problem(firstName: "Ayşe", lastName: "Yılmaz", country: bad),
                "\(bad) should be refused"
            )
        }

        XCTAssertNil(NewPatientModel.problem(firstName: "Ayşe", lastName: "Yılmaz", country: "tr"))
    }

    func testSendsTheFileWithoutAFileNumber() async throws {
        // The server allocates it. A client that could choose one could collide
        // with a file that already exists.
        let (model, transport) = try await make([
            HTTPResponse(status: 201, body: Data(created.utf8)),
        ])

        await model.create(
            firstName: " Ayşe ",
            lastName: " Yılmaz ",
            birthDate: Date(timeIntervalSince1970: 574_000_000),
            sex: "FEMALE",
            country: " tr ",
            city: nil,
            referralSource: nil
        )

        let requests = await transport.sent()
        let body = try XCTUnwrap(requests.first?.httpBody)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        XCTAssertNil(json["mrn"])
        // Trimmed and upper-cased before it leaves, so the record does not
        // carry whatever the keyboard left behind.
        XCTAssertEqual(json["firstName"] as? String, "Ayşe")
        XCTAssertEqual(json["country"] as? String, "TR")
    }

    func testReportsTheFileNumberTheServerAllocated() async throws {
        // Somebody is about to write it down.
        let (model, _) = try await make([
            HTTPResponse(status: 201, body: Data(created.utf8)),
        ])

        await model.create(
            firstName: "Ayşe",
            lastName: "Yılmaz",
            birthDate: Date(),
            sex: "FEMALE",
            country: "TR",
            city: nil,
            referralSource: nil
        )

        let state = await model.currentState()

        XCTAssertEqual(state.phase, .created(mrn: "2026-K7RMPX", id: "p1"))
    }

    func testAServerRefusalLeavesTheFormEditable() async throws {
        // Not stuck on "saving": whatever was wrong, the person has to be able
        // to correct it.
        let (model, _) = try await make([
            HTTPResponse(status: 422, body: Data(#"{"statusCode":422,"message":"Ülke kodu geçersiz"}"#.utf8)),
        ])

        let saved = await model.create(
            firstName: "Ayşe",
            lastName: "Yılmaz",
            birthDate: Date(),
            sex: "FEMALE",
            country: "TR",
            city: nil,
            referralSource: nil
        )

        let state = await model.currentState()

        XCTAssertFalse(saved)
        XCTAssertEqual(state.phase, .editing)
        XCTAssertEqual(state.error, "Ülke kodu geçersiz")
    }
}

import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikPatientsFeature

/// Answers based on the request's query, with a per-query delay, so a test can
/// make an earlier request finish *after* a later one.
private actor QueryTransport: HTTPTransport {
    private var bodies: [String: String]
    private var delays: [String: Duration]
    private(set) var requestedQueries: [String] = []

    init(bodies: [String: String], delays: [String: Duration] = [:]) {
        self.bodies = bodies
        self.delays = delays
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
        let query = components?.queryItems?.first { $0.name == "q" }?.value ?? ""
        let cursor = components?.queryItems?.first { $0.name == "cursor" }?.value

        let key = cursor.map { "\(query)|\($0)" } ?? query
        requestedQueries.append(key)

        if let delay = delays[key] {
            try? await Task.sleep(for: delay)
        }

        guard let body = bodies[key] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: 200, body: Data(body.utf8))
    }

    func queries() -> [String] { requestedQueries }
}

private struct FailingTransport: HTTPTransport {
    let error: APIError
    func send(_ request: URLRequest) async throws -> HTTPResponse { throw error }
}

private func signedInTokens() -> SessionTokens {
    SessionTokens(
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date().addingTimeInterval(900)
    )
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

/// The refresh token has been spent or the family revoked: the session is over.
private struct DeadRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unauthorized(ErrorResponse(statusCode: 401, message: "Unauthorized"))
    }
}

private struct AlwaysUnauthorized: HTTPTransport {
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        HTTPResponse(status: 401, body: Data(#"{"statusCode":401,"message":"Unauthorized"}"#.utf8))
    }
}

final class PatientListModelTests: XCTestCase {
    private func patient(_ id: String, _ surname: String = "Yilmaz") -> String {
        """
        {"id":"\(id)","mrn":"2026-AAAAAA","firstName":"Ayse","lastName":"\(surname)",
         "birthDate":"1985-03-12T00:00:00.000Z","sex":"FEMALE","country":"DE","city":null,
         "preferredLanguage":"tr","status":"LEAD","createdAt":"2026-01-01T00:00:00.000Z"}
        """
    }

    private func page(_ ids: [String], next: String? = nil, surname: String = "Yilmaz") -> String {
        let items = ids.map { patient($0, surname) }.joined(separator: ",")
        let cursor = next.map { "\"\($0)\"" } ?? "null"
        return #"{"items":[\#(items)],"nextCursor":\#(cursor)}"#
    }

    private func model(
        _ transport: HTTPTransport,
        pageSize: Int = 25,
        refresher: TokenRefresher = UnusedRefresher()
    ) async -> PatientListModel {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)
        try? await session.signIn(with: signedInTokens())
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )
        return PatientListModel(api: PatientsAPI(client: client), pageSize: pageSize)
    }

    func testLoadsTheFirstPage() async {
        let list = await model(QueryTransport(bodies: ["": page(["a", "b"])]))

        await list.search(query: "")

        let state = await list.currentState()
        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.patients.map(\.id), ["a", "b"])
        XCTAssertFalse(state.hasMore)
    }

    /// An empty result is not a failure; the screen invites a different search
    /// rather than offering a retry button.
    func testReportsAnEmptyResultAsEmptyRatherThanFailed() async {
        let list = await model(QueryTransport(bodies: ["nobody": page([])]))

        await list.search(query: "nobody")

        let state = await list.currentState()
        XCTAssertEqual(state.phase, .empty)
        XCTAssertTrue(state.patients.isEmpty)
    }

    func testAppendsTheNextPageWithoutRepeatingRows() async {
        let list = await model(
            QueryTransport(bodies: [
                "": page(["a", "b"], next: "cursor-1"),
                "|cursor-1": page(["c", "d"]),
            ])
        )

        await list.search(query: "")
        await list.loadMore()

        let state = await list.currentState()
        XCTAssertEqual(state.patients.map(\.id), ["a", "b", "c", "d"])
        XCTAssertFalse(state.hasMore)
        XCTAssertFalse(state.isLoadingMore)
    }

    func testDoesNothingOnLoadMoreWhenTheEndIsReached() async {
        let transport = QueryTransport(bodies: ["": page(["a"])])
        let list = await model(transport)

        await list.search(query: "")
        await list.loadMore()
        await list.loadMore()

        let requested = await transport.queries()
        XCTAssertEqual(requested, [""], "Only the first page should have been fetched")
    }

    /**
     The race this model exists to avoid.

     Typing "Zim" then "Zimm" sends two requests, and nothing promises they
     return in order. Without a guard, the slower answer for the shorter query
     lands last and the list shows results the user is no longer asking for.
     */
    func testASlowResponseForAnEarlierQueryDoesNotOverwriteANewerOne() async {
        let transport = QueryTransport(
            bodies: [
                "Zim": page(["old-1", "old-2"], surname: "Zimmer"),
                "Zimm": page(["new-1"], surname: "Zimmermann"),
            ],
            delays: ["Zim": .milliseconds(120), "Zimm": .milliseconds(10)]
        )
        let list = await model(transport)

        async let slow: Void = list.search(query: "Zim")
        // Far enough behind that the first request is already in flight.
        try? await Task.sleep(for: .milliseconds(20))
        async let fast: Void = list.search(query: "Zimm")

        _ = await (slow, fast)

        let state = await list.currentState()
        XCTAssertEqual(state.query, "Zimm")
        XCTAssertEqual(
            state.patients.map(\.id),
            ["new-1"],
            "The list must show the newest query's results, not whichever answer arrived last"
        )
    }

    /// A page that arrives after the user started a new search belongs to a
    /// list that no longer exists.
    func testAPageArrivingAfterANewSearchIsDropped() async {
        let transport = QueryTransport(
            bodies: [
                "": page(["a"], next: "cursor-1"),
                "|cursor-1": page(["b"]),
                "other": page(["z"]),
            ],
            delays: ["|cursor-1": .milliseconds(120)]
        )
        let list = await model(transport)

        await list.search(query: "")
        async let paging: Void = list.loadMore()
        try? await Task.sleep(for: .milliseconds(20))
        await list.search(query: "other")
        _ = await paging

        let state = await list.currentState()
        XCTAssertEqual(state.patients.map(\.id), ["z"])
    }

    func testShowsALocalisedMessageWhenOffline() async {
        let list = await model(FailingTransport(error: .offline))

        await list.search(query: "")

        let state = await list.currentState()
        XCTAssertEqual(state.phase, .failed(L10n.string("error.offline")))
    }

    /// Losing pages already on screen because page three failed would be worse
    /// than showing what we have.
    func testKeepsLoadedPagesWhenAFurtherPageFails() async {
        let transport = QueryTransport(bodies: ["": page(["a", "b"], next: "cursor-1")])
        let list = await model(transport)

        await list.search(query: "")
        // No body registered for the cursor, so the transport answers 500.
        await list.loadMore()

        let state = await list.currentState()
        XCTAssertEqual(state.patients.map(\.id), ["a", "b"])
        XCTAssertFalse(state.isLoadingMore)
    }

    /// A dead session is not a mistyped password. Telling a nurse mid-shift
    /// that her password is wrong sends her to change something that is fine.
    ///
    /// The realistic path: the request returns 401, the client refreshes, and
    /// the refresh is refused too because the chain is over.
    func testReportsAnExpiredSessionAsSuchRatherThanAsWrongCredentials() async {
        let list = await model(AlwaysUnauthorized(), refresher: DeadRefresher())

        await list.search(query: "")

        let state = await list.currentState()
        XCTAssertEqual(state.phase, .failed(L10n.string("error.sessionExpired")))
    }

    func testRetryRepeatsTheCurrentSearch() async {
        let transport = QueryTransport(bodies: ["Ayse": page(["a"])])
        let list = await model(transport)

        await list.search(query: "Ayse")
        await list.retry()

        let requested = await transport.queries()
        XCTAssertEqual(requested, ["Ayse", "Ayse"])
    }
}

final class PatientDetailModelTests: XCTestCase {
    private struct StatusTransport: HTTPTransport {
        let status: Int
        let body: String

        func send(_ request: URLRequest) async throws -> HTTPResponse {
            HTTPResponse(status: status, body: Data(body.utf8))
        }
    }

    private func model(_ transport: HTTPTransport) async -> PatientDetailModel {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        try? await session.signIn(with: signedInTokens())
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )
        return PatientDetailModel(api: PatientsAPI(client: client), patientId: "p1")
    }

    func testLoadsThePatient() async {
        let body = """
        {"id":"p1","mrn":"2026-K7RMPX","firstName":"Ayse","lastName":"Yilmaz",
         "birthDate":"1985-03-12T00:00:00.000Z","sex":"FEMALE","country":"DE","city":"Berlin",
         "preferredLanguage":"tr","status":"POST_OP","createdAt":"2026-01-01T00:00:00.000Z"}
        """
        let detail = await model(StatusTransport(status: 200, body: body))

        await detail.load()

        let state = await detail.currentState()
        guard case .loaded(let patient) = state.phase else {
            return XCTFail("Expected a loaded patient, got \(state.phase)")
        }
        XCTAssertEqual(patient.mrn, "2026-K7RMPX")
        XCTAssertEqual(patient.fullName, "Ayse Yilmaz")
    }

    /**
     The backend answers 404 both for a record that does not exist and for one
     outside this user's scope, so that an account cannot probe whether a named
     person is a patient here. The client must not undo that by saying
     "you do not have access".
     */
    func testTreatsOutOfScopeAsNotFoundWithoutRevealingExistence() async {
        let detail = await model(StatusTransport(status: 404, body: "{}"))

        await detail.load()

        let state = await detail.currentState()
        XCTAssertEqual(state.phase, .notFound)
    }

    func testReportsOtherFailuresWithAMessage() async {
        let detail = await model(StatusTransport(status: 503, body: "{}"))

        await detail.load()

        let state = await detail.currentState()
        XCTAssertEqual(state.phase, .failed(L10n.string("error.server")))
    }
}

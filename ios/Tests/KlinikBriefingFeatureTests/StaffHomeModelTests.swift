import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikBriefingFeature

private struct StubTransport: HTTPTransport {
    let bodies: [String: (Int, String)]

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"

        guard let (status, body) = bodies[key] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

private func risk(_ kind: String, name: String, minutes: Int) -> String {
    """
    {"patientId":"p-\(name)","patientName":"\(name)","kind":"\(kind)",
     "detail":"detay","waitingMinutes":\(minutes)}
    """
}

private func briefing(risks: [String], quiet: Bool = false, narrative: String? = nil) -> String {
    let narrativeJSON = narrative.map { "\"\($0)\"" } ?? "null"

    return """
    {"facts":{"generatedAt":"2026-09-09T06:00:00.000Z",
      "yesterday":{"newMessages":12,"urgentMessages":2,"emergencies":1,
                   "complications":0,"criticalLabs":3},
      "today":{"appointments":6,"followUps":3},
      "atRisk":[\(risks.joined(separator: ","))]},
     "narrative":\(narrativeJSON),"quiet":\(quiet)}
    """
}

private func model(_ bodies: [String: (Int, String)]) async -> StaffHomeModel {
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
        transport: StubTransport(bodies: bodies),
        session: session
    )

    return await StaffHomeModel(
        briefing: BriefingAPI(client: client),
        emergency: EmergencyAPI(client: client),
        reports: ReportsAPI(client: client)
    )
}

final class StaffHomeModelTests: XCTestCase {
    /**
     * Severity beats waiting time.
     *
     * The server returns the list already sorted for its own purposes, and the
     * temptation is to render it as it arrives. A follow-up somebody has missed
     * for three days would then sit above an emergency call raised four minutes
     * ago, which is the wrong order for the only reader this screen has.
     */
    func testUnansweredEmergencySortsAboveALongerWaitingFollowUp() async {
        let sut = await model([
            "GET /me/briefing": (200, briefing(risks: [
                risk("follow-up-missed", name: "Uzun Bekleyen", minutes: 4_320),
                risk("emergency-unanswered", name: "Acil Cagri", minutes: 4),
            ])),
        ])

        await sut.load()
        let ordered = await sut.risks()

        XCTAssertEqual(ordered.first?.patientName, "Acil Cagri")
        XCTAssertEqual(ordered.last?.patientName, "Uzun Bekleyen")
    }

    /// Within one severity, the person who has waited longest is first.
    func testWaitingTimeBreaksTiesWithinAKind() async {
        let sut = await model([
            "GET /me/briefing": (200, briefing(risks: [
                risk("message-urgent", name: "Yeni", minutes: 10),
                risk("message-urgent", name: "Eski", minutes: 90),
            ])),
        ])

        await sut.load()

        let first = await sut.risks().first?.patientName
        XCTAssertEqual(first, "Eski")
    }

    /**
     * A queue this account may not read must not blank the agenda.
     *
     * A coordinator has no `reports.review`. Before this was split out, a 403
     * on the report queue took the whole screen down and the person saw an
     * error instead of their morning.
     */
    func testAForbiddenReportQueueLeavesTheBriefingIntact() async {
        let sut = await model([
            "GET /me/briefing": (200, briefing(risks: [])),
            "GET /reports/pending": (403, #"{"statusCode":403,"message":"forbidden"}"#),
        ])

        await sut.load()
        let state = await sut.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertNotNil(state.briefing)
        // Nil, not zero: the screen shows nothing rather than "0 bekliyor",
        // which would read as a queue that happens to be empty.
        XCTAssertNil(state.pendingReportCount)
    }

    /// The briefing itself is the page; losing it is a failure.
    func testAFailedBriefingFailsTheScreen() async {
        let sut = await model([:])

        await sut.load()

        guard case .failed = await sut.currentState().phase else {
            return XCTFail("expected the screen to report the failure")
        }
    }

    func testEmergenciesAreOrderedByHowLongTheyHaveWaited() async {
        let calls = """
        [{"event":{"id":"a","patientId":"p1","status":"TRIGGERED",
           "triggeredAt":"2026-09-09T06:00:00.000Z","latitude":null,"longitude":null,
           "note":null,"escalationLevel":0,"acknowledgedAt":null,"resolution":null,
           "resolvedAt":null},
          "summary":\(summary(name: "Yeni")),"waitingMinutes":2,
          "responseMinutes":null,"unanswered":false},
         {"event":{"id":"b","patientId":"p2","status":"TRIGGERED",
           "triggeredAt":"2026-09-09T05:40:00.000Z","latitude":null,"longitude":null,
           "note":null,"escalationLevel":2,"acknowledgedAt":null,"resolution":null,
           "resolvedAt":null},
          "summary":\(summary(name: "Bekleyen")),"waitingMinutes":22,
          "responseMinutes":null,"unanswered":true}]
        """

        let sut = await model([
            "GET /me/briefing": (200, briefing(risks: [])),
            "GET /emergency": (200, calls),
        ])

        await sut.load()
        let state = await sut.currentState()

        XCTAssertTrue(state.hasEmergencies)
        XCTAssertEqual(state.worstEmergencyWait, 22)
        XCTAssertEqual(state.emergencies.first?.summary.fullName, "Bekleyen")
    }
}

private func summary(name: String) -> String {
    """
    {"patientId":"p1","mrn":"2026-AAA","fullName":"\(name)","age":41,"sex":"FEMALE",
     "country":"TR","city":null,"phone":null,"preferredLanguage":"tr","bloodType":"A+",
     "allergies":[],"chronicConditions":[],"currentMedications":[],
     "lastSurgery":null,"assignedDoctor":null}
    """
}

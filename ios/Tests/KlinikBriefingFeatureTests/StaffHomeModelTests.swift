import XCTest
import KlinikAPI
import KlinikCore
import KlinikDesign
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
        reports: ReportsAPI(client: client),
        photos: PhotosAPI(client: client),
        appointments: AppointmentsAPI(client: client)
    )
}

/// One row of a day's calendar, on the wire.
private func slot(
    id: String,
    at when: String,
    name: String,
    minutes: Int = 30,
    status: String = "CONFIRMED"
) -> String {
    """
    {"appointment":{"id":"\(id)","patientId":"p-\(id)","staffId":"s1",
      "type":"CONTROL","status":"\(status)","scheduledAt":"\(when)",
      "durationMinutes":\(minutes),"location":null,"note":null,
      "cancelledAt":null,"cancelledReason":null,"remindersSent":[]},
     "patient":{"id":"p-\(id)","mrn":"2026-\(id)","fullName":"\(name)"}}
    """
}

/// The format the API speaks, so a test's clock and the wire agree.
private func instant(_ text: String) throws -> Date {
    try Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text)
}

private func day(_ slots: [String]) throws -> [CalendarEntry] {
    try JSONDecoder.klinik.decode(
        [CalendarEntry].self,
        from: Data("[\(slots.joined(separator: ","))]".utf8)
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

    /// Decoded rather than constructed: the API types have no public
    /// memberwise init, and the wire shape is what the screen actually sees.
    private func yesterday(
        messages: Int = 0,
        urgent: Int = 0,
        emergencies: Int = 0,
        complications: Int = 0,
        criticalLabs: Int = 0
    ) throws -> BriefingYesterday {
        let json = """
        {"newMessages":\(messages),"urgentMessages":\(urgent),
         "emergencies":\(emergencies),"complications":\(complications),
         "criticalLabs":\(criticalLabs)}
        """

        return try JSONDecoder().decode(
            BriefingYesterday.self,
            from: Data(json.utf8)
        )
    }

    /**
     * Every one of yesterday's counts is shown, including the zeros.
     *
     * They were briefly filtered down to the counts above zero, and the doctor
     * who uses this app read that as four things the app had lost. A zero is an
     * answer: "no emergencies yesterday" is exactly what a clinician wants to
     * know, and it cannot be read off a row that is not there.
     */
    func testYesterdayKeepsEveryCountIncludingTheZeros() throws {
        let metrics = StaffHomeScreen.yesterdayMetrics(
            try yesterday(messages: 7, complications: 2)
        )

        XCTAssertEqual(
            metrics.map(\.labelKey),
            [
                "briefing.newMessages",
                "briefing.urgentMessages",
                "briefing.emergencies",
                "briefing.complications",
                "briefing.criticalLabs",
            ]
        )
    }

    /// A zero is drawn, but it does not get to wear the colour that means
    /// something happened.
    func testAZeroCountIsDrawnInTheNeutralTone() throws {
        let metrics = StaffHomeScreen.yesterdayMetrics(try yesterday(criticalLabs: 3))

        let labs = try XCTUnwrap(metrics.first { $0.labelKey == "briefing.criticalLabs" })
        let emergencies = try XCTUnwrap(metrics.first { $0.labelKey == "briefing.emergencies" })

        XCTAssertFalse(labs.isQuiet)
        XCTAssertEqual(labs.shownTone, .critical)

        XCTAssertTrue(emergencies.isQuiet)
        XCTAssertEqual(emergencies.shownTone, .neutral)
    }

    // MARK: - Today's schedule

    /// The day, in the order the clock will run it — whatever order it arrives
    /// in. The calendar endpoint sorts for a month grid, not for one day.
    func testTheDayIsPutInClockOrder() async throws {
        let sut = await model([
            "GET /me/briefing": (200, briefing(risks: [])),
            "GET /appointments/calendar": (200, """
            [\(slot(id: "b", at: "2026-09-09T13:00:00.000Z", name: "Sonraki")),
             \(slot(id: "a", at: "2026-09-09T09:00:00.000Z", name: "Once"))]
            """),
        ])

        await sut.load()

        let state = await sut.currentState()
        let schedule = try XCTUnwrap(state.schedule)
        XCTAssertEqual(schedule.map(\.patient.fullName), ["Once", "Sonraki"])
    }

    /**
     * A calendar this account may not read leaves the section absent.
     *
     * Absent, not empty. An empty list on screen says "nothing booked today",
     * which is a claim about the clinic's day — and a 403 is not evidence for
     * it.
     */
    func testAForbiddenCalendarLeavesTheScheduleAbsentRatherThanEmpty() async {
        let sut = await model([
            "GET /me/briefing": (200, briefing(risks: [])),
            "GET /appointments/calendar": (403, #"{"statusCode":403,"message":"forbidden"}"#),
        ])

        await sut.load()
        let state = await sut.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertNil(state.schedule)
    }

    /**
     * "Sıradaki" is the next one somebody is still expected at.
     *
     * Not the next row on the list: the appointment that finished an hour ago
     * is not next, and neither is the slot that was cancelled — marking either
     * would send a doctor to a room with nobody in it.
     */
    func testNextUpSkipsWhatIsFinishedAndWhatWasCancelled() throws {
        let schedule = try day([
            slot(id: "a", at: "2026-09-09T09:00:00.000Z", name: "Biten"),
            slot(id: "b", at: "2026-09-09T13:00:00.000Z", name: "Iptal", status: "CANCELLED"),
            slot(id: "c", at: "2026-09-09T15:00:00.000Z", name: "Sirada"),
        ])

        let noon = try instant("2026-09-09T12:00:00.000Z")

        XCTAssertEqual(StaffHomeScreen.nextUp(in: schedule, at: noon), "c")
    }

    /// Once the day is over nothing is next, and nothing is marked.
    func testNothingIsNextAfterTheLastAppointment() throws {
        let schedule = try day([
            slot(id: "a", at: "2026-09-09T09:00:00.000Z", name: "Biten"),
        ])

        let evening = try instant("2026-09-09T18:00:00.000Z")

        XCTAssertNil(StaffHomeScreen.nextUp(in: schedule, at: evening))
    }

    /// An appointment that has started but not ended is still the one to be at.
    func testAnAppointmentUnderWayIsStillNext() throws {
        let schedule = try day([
            slot(id: "a", at: "2026-09-09T09:00:00.000Z", name: "Suren", minutes: 60),
            slot(id: "b", at: "2026-09-09T15:00:00.000Z", name: "Sonraki"),
        ])

        let during = try instant("2026-09-09T09:30:00.000Z")

        XCTAssertEqual(StaffHomeScreen.nextUp(in: schedule, at: during), "a")
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

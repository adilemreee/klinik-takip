import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * The morning briefing, as the doctor's screen sees it.
 *
 * The one property worth a test on the client: the screen is rendered from the
 * facts, not from the paragraph — otherwise a switched-off AI layer looks like
 * an empty morning.
 */
final class BriefingAPITests: XCTestCase {
    private func decode(_ json: String) throws -> Briefing {
        try JSONDecoder.klinik.decode(Briefing.self, from: Data(json.utf8))
    }

    private let busy = """
    {"facts":{"generatedAt":"2026-03-04T05:00:00.000Z",
      "yesterday":{"newMessages":7,"urgentMessages":2,"emergencies":1,
                   "complications":0,"criticalLabs":3},
      "today":{"appointments":5,"followUps":2},
      "atRisk":[{"patientId":"p1","patientName":"Ayşe Yılmaz",
                 "kind":"emergency-unanswered","detail":"Acil çağrı yanıtlanmadı",
                 "waitingMinutes":20}]},
     "narrative":"Bir acil çağrı bekliyor.","quiet":false}
    """

    func testReadsTheFactsAndTheParagraph() throws {
        let briefing = try decode(busy)

        XCTAssertEqual(briefing.facts.yesterday.newMessages, 7)
        XCTAssertEqual(briefing.facts.today.appointments, 5)
        XCTAssertEqual(briefing.narrative, "Bir acil çağrı bekliyor.")
        XCTAssertTrue(briefing.hasContent)
    }

    /**
     * A briefing with no paragraph is still a briefing. Rendering the screen off
     * the prose would make a switched-off AI layer look like an empty morning.
     */
    func testShowsTheBriefingWhenThereIsNoParagraph() throws {
        let briefing = try decode(
            busy.replacingOccurrences(of: "\"narrative\":\"Bir acil çağrı bekliyor.\"", with: "\"narrative\":null")
        )

        XCTAssertNil(briefing.narrative)
        XCTAssertTrue(briefing.hasContent)
        XCTAssertEqual(briefing.facts.atRisk.count, 1)
    }

    func testSaysNothingIsWaitingOnAQuietMorning() throws {
        let briefing = try decode(
            """
            {"facts":{"generatedAt":"2026-03-04T05:00:00.000Z",
              "yesterday":{"newMessages":0,"urgentMessages":0,"emergencies":0,
                           "complications":0,"criticalLabs":0},
              "today":{"appointments":0,"followUps":0},"atRisk":[]},
             "narrative":null,"quiet":true}
            """
        )

        XCTAssertFalse(briefing.hasContent)
        XCTAssertTrue(briefing.facts.atRisk.isEmpty)
    }

    func testReadsEveryKindOfRiskTheServerCanSend() {
        for kind in RiskKind.allCases {
            XCTAssertFalse(kind.localizedName.isEmpty)
            XCTAssertNotEqual(kind.localizedName, "briefing.risk.\(kind.rawValue)")
        }
    }

    /** A doctor does not read "4,320 minutes". */
    func testWritesALongWaitInHours() throws {
        let briefing = try decode(busy)
        let recent = briefing.facts.atRisk[0]

        XCTAssertTrue(recent.localizedWaiting.contains("20"))

        let old = RiskItem(
            patientId: "p2",
            patientName: "X",
            kind: .followUpMissed,
            detail: "d",
            waitingMinutes: 4_320
        )

        XCTAssertTrue(old.localizedWaiting.contains("72"))
    }
}

private extension RiskItem {
    /// Test-only construction; the type is decoded from the server in the app.
    init(patientId: String, patientName: String, kind: RiskKind, detail: String, waitingMinutes: Int) {
        let json = """
        {"patientId":"\(patientId)","patientName":"\(patientName)","kind":"\(kind.rawValue)",
         "detail":"\(detail)","waitingMinutes":\(waitingMinutes)}
        """
        // swiftlint:disable:next force_try
        self = try! JSONDecoder.klinik.decode(RiskItem.self, from: Data(json.utf8))
    }
}

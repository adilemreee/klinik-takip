import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * Medication as the patient's screen sees it (spec M9).
 *
 * The property that matters on the client: a course with nothing due yet has no
 * score, and rendering that as nought per cent would tell a patient on their
 * first morning that they are failing.
 */
final class MedicationsAPITests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as type: T.Type) throws -> T {
        try JSONDecoder.klinik.decode(type, from: Data(json.utf8))
    }

    private func medication(
        approvedAt: String = "\"2026-03-01T08:00:00.000Z\"",
        stoppedAt: String = "null",
        source: String = "PRESCRIBED"
    ) -> String {
        """
        {"id":"m1","patientId":"p1","drugName":"Amoksisilin","dose":"500 mg","form":"tablet",
         "frequencyRule":"FREQ=DAILY;COUNT=16;BYHOUR=9,21","timezone":"Europe/Berlin",
         "startDate":"2026-03-02T00:00:00.000Z","endDate":null,"instructions":null,
         "source":"\(source)","approvedAt":\(approvedAt),"stoppedAt":\(stoppedAt)}
        """
    }

    private func view(adherence: String, badges: String = "[]") -> String {
        """
        {"medication":\(medication()),"schedule":"günde 2, 16 doz",
         "adherence":\(adherence),"badges":\(badges),"nextDose":"2026-03-02T20:00:00.000Z"}
        """
    }

    func testHasNoScoreBeforeAnyDoseHasComeDue() throws {
        let parsed = try decode(
            view(adherence: #"{"score":null,"taken":0,"missed":0,"due":0,"upcoming":16,"streak":0}"#),
            as: MedicationView.self
        )

        XCTAssertFalse(parsed.adherence.hasScore)
        XCTAssertNil(parsed.adherence.percentage)
    }

    func testReportsTheScoreAsAWholePercentageOnceThereIsOne() throws {
        let parsed = try decode(
            view(adherence: #"{"score":0.8333,"taken":5,"missed":1,"due":6,"upcoming":10,"streak":2}"#),
            as: MedicationView.self
        )

        XCTAssertTrue(parsed.adherence.hasScore)
        XCTAssertEqual(parsed.adherence.percentage, 83)
        XCTAssertEqual(parsed.adherence.streak, 2)
    }

    /** Inert until a clinician approves it: no schedule, nothing counted. */
    func testTellsApartAPrescribedCourseFromOneWaitingForApproval() throws {
        let prescribed = try decode(medication(), as: Medication.self)
        let waiting = try decode(
            medication(approvedAt: "null", source: "PATIENT_REPORTED"),
            as: Medication.self
        )

        XCTAssertTrue(prescribed.isActive)
        XCTAssertFalse(prescribed.awaitingApproval)

        XCTAssertFalse(waiting.isActive)
        XCTAssertTrue(waiting.awaitingApproval)
        XCTAssertEqual(waiting.source, .patientReported)
    }

    func testSeparatesTheDosesStillWaitingFromTheOnesAnswered() throws {
        let mine = try decode(
            """
            {"medications":[],"today":[
              {"id":"d1","medicationId":"m1","scheduledAt":"2026-03-02T06:00:00.000Z","takenAt":null,"status":"TAKEN","snoozedUntil":null},
              {"id":"d2","medicationId":"m1","scheduledAt":"2026-03-02T18:00:00.000Z","takenAt":null,"status":"PENDING","snoozedUntil":null},
              {"id":"d3","medicationId":"m1","scheduledAt":"2026-03-02T20:00:00.000Z","takenAt":null,"status":"SNOOZED","snoozedUntil":null},
              {"id":"d4","medicationId":"m1","scheduledAt":"2026-03-02T22:00:00.000Z","takenAt":null,"status":"LATE","snoozedUntil":null}],
             "overall":{"score":1.0,"taken":2,"missed":0,"due":2,"upcoming":2,"streak":1},
             "badges":["first-dose"]}
            """,
            as: MyMedications.self
        )

        XCTAssertEqual(mine.openToday.map(\.id), ["d2", "d3"])
        // A late dose is taken; the patient is not shown it as something to do.
        XCTAssertFalse(DoseStatus.late.isOpen)
        XCTAssertTrue(DoseStatus.snoozed.isOpen)
    }

    func testRendersTheBadgesFromTheCatalogue() throws {
        let mine = try decode(
            """
            {"medications":[],"today":[],
             "overall":{"score":1.0,"taken":9,"missed":0,"due":9,"upcoming":0,"streak":7},
             "badges":["first-dose","three-days","one-week"]}
            """,
            as: MyMedications.self
        )

        for text in mine.localizedBadges {
            XCTAssertFalse(text.isEmpty)
            XCTAssertFalse(text.hasPrefix("medication.badge."))
        }
    }

    /**
     * The tone rule from M9: no badges over a list of missed doses. The server
     * withholds them, and the client shows what it is given.
     */
    func testShowsNoBadgesWhenTheServerWithheldThem() throws {
        let mine = try decode(
            """
            {"medications":[],"today":[],
             "overall":{"score":0.2,"taken":2,"missed":8,"due":10,"upcoming":0,"streak":0},
             "badges":[]}
            """,
            as: MyMedications.self
        )

        XCTAssertTrue(mine.badges.isEmpty)
        XCTAssertEqual(mine.overall.percentage, 20)
    }

    func testHasAWordForEveryDoseStatus() {
        for status in [DoseStatus.pending, .taken, .skipped, .late, .snoozed] {
            XCTAssertNotEqual(status.localizedName, "medication.status.\(status.rawValue)")
            XCTAssertFalse(status.localizedName.isEmpty)
        }
    }
}

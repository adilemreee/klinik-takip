import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikPatientsFeature

/// The two pieces of judgement on the file screen: what a section row says
/// under its name, and how a half-filled medical card is read.
final class PatientFileTests: XCTestCase {
    /// Built from JSON rather than a memberwise initialiser: the API types
    /// decode and do not construct, which is what keeps a client from
    /// inventing a record the server never sent.
    private func file(
        unread: Int = 0,
        awaitingLabs: Int = 0,
        criticalLabs: Int = 0,
        adherence: String = "null",
        measurements: String = "[]"
    ) throws -> PatientFile {
        let json = """
        {"patient":{"id":"p1","mrn":"2026-AAA","firstName":"Ayşe","lastName":"Yılmaz",
          "birthDate":"1985-03-12T00:00:00.000Z","age":40,"sex":"FEMALE","country":"DE",
          "city":"Berlin","nationality":null,"preferredLanguage":"tr","referralSource":null,
          "status":"POST_OP","createdAt":"2026-01-01T00:00:00.000Z","version":3},
         "contact":{"email":null,"phone":null},
         "medicalProfile":null,"lastSurgery":null,"assignments":[],
         "latestMeasurements":\(measurements),
         "alerts":{"criticalLabs":\(criticalLabs),"labsAwaitingReview":\(awaitingLabs),
                   "openComplications":0,"openEmergency":false,"processingDocuments":0,
                   "unreviewedReports":0},
         "lastMessage":null,"unreadMessages":\(unread),
         "nextAppointment":null,"nextFollowUp":null,"adherence":\(adherence),
         "counts":{"documents":0,"photos":0,"labResults":0,"appointments":0}}
        """

        return try JSONDecoder.klinik.decode(PatientFile.self, from: Data(json.utf8))
    }

    private func measurement(
        type: String,
        value: String,
        secondary: String? = nil,
        unit: String
    ) -> String {
        let second = secondary.map { "\"\($0)\"" } ?? "null"

        return """
        [{"type":"\(type)","value":"\(value)","secondaryValue":\(second),"unit":"\(unit)",
          "measuredAt":"2026-09-09T08:00:00.000Z","source":"NURSE"}]
        """
    }

    private func adherence(score: Double, taken: Int, missed: Int, due: Int) -> String {
        """
        {"score":\(score),"taken":\(taken),"missed":\(missed),"due":\(due),
         "upcoming":8,"streak":0,"activeMedications":1}
        """
    }

    /**
     * A section with nothing waiting carries no badge.
     *
     * Rendering zero would be worse than nothing: a row reading "Tahliller · 0"
     * looks like a section that failed to load, and a doctor scanning nine rows
     * for the one that needs them would have to read every number.
     */
    func testAnEmptySectionHasNoBadge() throws {
        let file = try file()

        XCTAssertNil(file.badge(for: .messages))
        XCTAssertNil(file.badge(for: .labReview))
        XCTAssertNil(file.badge(for: .photos))
    }

    func testWaitingWorkIsMarkedUrgent() throws {
        let file = try file(unread: 3, awaitingLabs: 2, criticalLabs: 1)

        XCTAssertEqual(file.badge(for: .messages)?.text, "3")
        XCTAssertEqual(file.badge(for: .messages)?.urgent, true)
        XCTAssertEqual(file.badge(for: .labReview)?.text, "2")
        XCTAssertEqual(file.badge(for: .labTrend)?.urgent, true)
    }

    /// The measurements row shows the reading itself, not a count: "72.4 kg"
    /// tells a clinician whether to tap; "8" does not.
    func testTheMeasurementsRowShowsTheLatestReading() throws {
        let file = try file(measurements: measurement(type: "WEIGHT", value: "72.4", unit: "kg"))

        XCTAssertEqual(file.badge(for: .measurements)?.text, "72.4 kg")
    }

    /// Blood pressure is the one reading with two numbers.
    func testBloodPressureReadsAsAPair() throws {
        let file = try file(
            measurements: measurement(
                type: "BLOOD_PRESSURE", value: "120", secondary: "80", unit: "mmHg"
            )
        )

        XCTAssertEqual(file.latestMeasurements.first?.reading, "120/80 mmHg")
    }

    /**
     * Low adherence is marked, and only once enough doses have come due.
     *
     * The spec's threshold is 70% (M9). Applying it to a patient's first
     * morning — one dose due, one missed, 0% — would warn a doctor about
     * somebody who has barely started.
     */
    func testAdherenceIsOnlyJudgedOnceThereIsEnoughOfIt() throws {
        let early = try file(adherence: adherence(score: 0, taken: 0, missed: 1, due: 1))
        let settled = try file(adherence: adherence(score: 0.5, taken: 4, missed: 4, due: 8))

        XCTAssertEqual(early.adherence?.needsAttention, false)
        XCTAssertEqual(settled.adherence?.needsAttention, true)
        XCTAssertEqual(settled.badge(for: .medications)?.urgent, true)
        XCTAssertEqual(settled.badge(for: .medications)?.text, "%50")
    }

    /// A question nobody asked is not a "no".
    func testAnUnansweredYesNoSaysSo() {
        XCTAssertEqual(PatientFileScreen.yesNo(nil), L10n.string("file.unknown"))
        XCTAssertNotEqual(PatientFileScreen.yesNo(nil), PatientFileScreen.yesNo(false))
        XCTAssertEqual(Tristate(nil), .unknown)
        XCTAssertEqual(Tristate(false).value, false)
        XCTAssertNil(Tristate.unknown.value)
    }

    /// "penisilin, , lateks" is two allergies, not three.
    func testCommaListsDropEmptyEntries() {
        XCTAssertEqual(
            EditMedicalSheet.list("penisilin, , lateks "),
            ["penisilin", "lateks"]
        )
        XCTAssertEqual(EditMedicalSheet.list("   "), [])
    }

    /// A Turkish keyboard produces a comma; a field that refuses it reads as
    /// broken.
    func testWeightAcceptsBothDecimalSeparators() {
        XCTAssertEqual(EditMedicalSheet.weight("72,4"), 72.4)
        XCTAssertEqual(EditMedicalSheet.weight("72.4"), 72.4)
        XCTAssertNil(EditMedicalSheet.weight(""))
        XCTAssertNil(EditMedicalSheet.weight("epey"))
    }
}

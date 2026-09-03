import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * The report shapes, and the one property that matters on the client.
 *
 * The server decides what a patient may see; the client's job is to render it
 * with the warning attached and never to reconstruct the clinical half.
 */
final class ReportsAPITests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as type: T.Type) throws -> T {
        try JSONDecoder.klinik.decode(type, from: Data(json.utf8))
    }

    private let patientReport = """
    {"id":"r1","source":"lab",
     "contentMd":"Kan değerlerinizden biri beklenenin altında.",
     "generatedAt":"2026-03-01T08:00:00.000Z",
     "releasedAt":"2026-03-01T09:00:00.000Z",
     "disclaimer":"Bu içerik yapay zeka tarafından üretilmiştir, tıbbi tanı yerine geçmez."}
    """

    private let staffView = """
    {"report":{"id":"r1","patientId":"p1","source":"lab",
      "contentMd":"## Bulgular\\nHemoglobin kritik düşük.",
      "patientFacingMd":"Kan değerlerinizden biri beklenenin altında.",
      "riskLevel":"CRITICAL","model":"test-model-2026","modelVersion":"test-model-2026",
      "generatedAt":"2026-03-01T08:00:00.000Z","reviewedById":null,
      "reviewedAt":null,"releasedToPatientAt":null},
     "disclaimer":"Bu içerik yapay zeka tarafından üretilmiştir, tıbbi tanı yerine geçmez.",
     "visibleToPatient":false}
    """

    /**
     * The patient's document has no field for the clinical text and none for
     * the risk label, so a client cannot show either by accident.
     */
    func testThePatientDocumentCarriesNoClinicalTextAndNoRiskLabel() throws {
        let report = try decode(patientReport, as: PatientReport.self)

        XCTAssertEqual(report.contentMd, "Kan değerlerinizden biri beklenenin altında.")
        XCTAssertFalse(report.disclaimer.isEmpty)

        let mirror = Mirror(reflecting: report)
        let fields = mirror.children.compactMap(\.label)
        XCTAssertFalse(fields.contains("riskLevel"))
        XCTAssertFalse(fields.contains("patientFacingMd"))
    }

    func testTheWarningComesFromTheServerRatherThanTheClient() throws {
        let report = try decode(patientReport, as: PatientReport.self)

        // Not a client string: an SMS or an export has no client to localise it,
        // and a warning the client forgets to add is a warning that is missing.
        XCTAssertTrue(report.disclaimer.contains("tanı yerine geçmez"))
    }

    func testTheStaffViewKeepsBothRenderingsApart() throws {
        let view = try decode(staffView, as: ReportView.self)

        XCTAssertTrue(view.report.contentMd.contains("kritik düşük"))
        XCTAssertEqual(view.report.patientFacingMd, "Kan değerlerinizden biri beklenenin altında.")
        XCTAssertFalse(view.visibleToPatient)
        XCTAssertFalse(view.isReviewed)
    }

    func testMarksTheReportsAClinicianShouldOpenFirst() throws {
        let view = try decode(staffView, as: ReportView.self)

        XCTAssertEqual(view.report.riskLevel, .critical)
        XCTAssertTrue(view.report.riskLevel!.needsAttention)
        XCTAssertFalse(RiskLevel.low.needsAttention)
        XCTAssertFalse(RiskLevel.medium.needsAttention)
    }

    func testHasAWordForEveryRiskLevel() {
        for risk in [RiskLevel.low, .medium, .high, .critical] {
            XCTAssertFalse(risk.localizedName.isEmpty)
            XCTAssertNotEqual(risk.localizedName, "report.risk.\(risk.rawValue)")
        }
    }
}

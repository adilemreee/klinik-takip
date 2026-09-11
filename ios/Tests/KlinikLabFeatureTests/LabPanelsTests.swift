import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikLabFeature

private func result(
    _ name: String,
    value: String = "106",
    unit: String = "U/L",
    low: String? = "10",
    high: String? = "49",
    flag: LabFlag? = .high
) -> LabResult {
    let json = """
    {"id":"\(name)","analyteCode":null,"analyteName":"\(name)","value":"\(value)",\
    "unit":"\(unit)","refLow":\(low.map { "\"\($0)\"" } ?? "null"),\
    "refHigh":\(high.map { "\"\($0)\"" } ?? "null"),\
    "flag":\(flag.map { "\"\($0.rawValue)\"" } ?? "null"),\
    "measuredAt":"2026-03-26T11:29:00.000Z","ocrConfidence":null,\
    "verifiedAt":"2026-03-26T12:00:00.000Z"}
    """

    return try! JSONDecoder.klinik.decode(LabResult.self, from: Data(json.utf8))
}

/**
 * The lab report, as a table (spec M16).
 *
 * The rule under every one of these: a result with no reference range is
 * **unclassified**, not normal. Showing a tick beside a number nobody can
 * place is the table telling a patient something it does not know.
 */
final class LabPanelsTests: XCTestCase {
    func testAValueOutsideItsRangeIsMarked() {
        XCTAssertTrue(result("ALT", flag: .high).isOutOfRange)
        XCTAssertTrue(result("Glukoz", flag: .low).isOutOfRange)
        XCTAssertTrue(result("CRP", flag: .critical).isOutOfRange)
    }

    func testAValueInsideItsRangeIsNot() {
        XCTAssertFalse(result("ALP", flag: .normal).isOutOfRange)
    }

    /// The case the screenshot has twice: hGFH and BUN print without a range.
    func testAValueWithNoRangeIsNotCountedAsNormal() {
        let unranged = result("hGFH", low: nil, high: nil, flag: nil)

        XCTAssertFalse(unranged.isOutOfRange)
        XCTAssertEqual(ResultRow.tone(for: unranged), .neutral, "Unclassified, not normal")
        XCTAssertEqual(ResultRow.symbol(for: unranged), "questionmark.circle")
        XCTAssertNil(unranged.referenceText)
    }

    func testTheRangeReadsAsItWasPrinted() {
        XCTAssertEqual(result("ALT").referenceText, "10 – 49")
        XCTAssertEqual(result("CRP", low: nil, high: "5").referenceText, "< 5")
        XCTAssertEqual(result("Ürik", low: "3.7", high: nil).referenceText, "> 3.7")
    }

    // MARK: - The panel

    private func panel(_ results: [LabResult], documentId: String? = "d1") -> LabPanel {
        LabPanel(
            measuredAt: Date(timeIntervalSince1970: 1_774_524_540),
            documentId: documentId,
            documentName: "tahlil.pdf",
            results: results
        )
    }

    /// The number somebody opens a report for.
    func testTheHeaderCountsWhatIsOutOfRange() {
        let sut = panel([
            result("ALT", flag: .high),
            result("ALP", flag: .normal),
            result("CRP", flag: .critical),
            result("hGFH", low: nil, high: nil, flag: nil),
        ])

        XCTAssertEqual(sut.abnormal, 2)
        XCTAssertEqual(sut.results.count, 4)
    }

    /// Two draws on one morning are two reports, and a reader looking for the
    /// one they were handed needs them apart.
    func testTwoReportsAtTheSameMomentAreNotTheSamePanel() {
        let first = panel([result("ALT")], documentId: "d1")
        let second = panel([result("ALT")], documentId: "d2")

        XCTAssertNotEqual(first.id, second.id)
    }

    func testAPanelWithNoDocumentStillHasAnIdentity() {
        XCTAssertFalse(panel([result("ALT")], documentId: nil).id.isEmpty)
    }

    // MARK: - What a screen reader hears

    /// An icon it cannot see is no use: the value, whether it is in range, and
    /// what the range was all have to be in the words.
    func testTheSpokenRowCarriesTheRangeAndTheVerdict() {
        let spoken = ResultRow.spoken(result("ALT", value: "106", flag: .high))

        XCTAssertTrue(spoken.contains("ALT"))
        XCTAssertTrue(spoken.contains("106"))
        XCTAssertTrue(spoken.contains("U/L"))
        XCTAssertTrue(spoken.contains("10 – 49"))
        XCTAssertTrue(spoken.contains(LabFlag.high.localizedName))
    }

    func testTheSpokenRowSaysNothingItDoesNotKnow() {
        let spoken = ResultRow.spoken(result("hGFH", value: "125,9", low: nil, high: nil, flag: nil))

        XCTAssertTrue(spoken.contains("125,9"))
        XCTAssertFalse(spoken.contains(LabFlag.normal.localizedName))
    }

    func testTheDateIsShownToTheMinute() {
        let text = PanelSection.moment(Date(timeIntervalSince1970: 1_774_524_540))

        // Two draws on one morning must not read as one; the day alone would
        // merge them on screen while the data keeps them apart.
        XCTAssertTrue(text.contains("2026"))
        XCTAssertTrue(text.contains(":"))
    }

    /**
     * A report row that names a file with nothing behind it.
     *
     * Demo data does this on purpose — a fabricated PDF of invented results
     * sitting in a clinic's bucket is worse than nothing — and a real document
     * whose bytes went missing does it by accident. Either way the reader is
     * not offered a button that opens an error.
     */
    func testTheReportIsNotOfferedWhenThereAreNoBytesBehindIt() {
        let withoutFile = LabPanel(
            measuredAt: Date(),
            documentId: "d1",
            documentName: "hemogram.pdf",
            documentAvailable: false,
            results: []
        )

        XCTAssertFalse(withoutFile.canOpenReport)

        let withFile = LabPanel(
            measuredAt: Date(),
            documentId: "d1",
            documentName: "hemogram.pdf",
            documentAvailable: true,
            results: []
        )

        XCTAssertTrue(withFile.canOpenReport)
    }

    /// No document at all is the other way to have nothing to open.
    func testAPanelWithNoDocumentOffersNothing() {
        let panel = LabPanel(measuredAt: Date(), documentAvailable: true, results: [])

        XCTAssertFalse(panel.canOpenReport)
    }

    /// A server that does not send the field yet is read as "no file", which
    /// is the safe reading: no offer rather than a broken one.
    func testAMissingFieldMeansNoOffer() throws {
        let json = #"""
        {"measuredAt":"2026-09-01T08:00:00.000Z","documentId":"d1",
         "documentName":"a.pdf","results":[]}
        """#

        let panel = try JSONDecoder.klinik.decode(LabPanel.self, from: Data(json.utf8))

        XCTAssertFalse(panel.documentAvailable)
        XCTAssertFalse(panel.canOpenReport)
    }
}

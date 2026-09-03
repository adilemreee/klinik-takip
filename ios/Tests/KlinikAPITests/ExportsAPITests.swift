import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * Patient summary exports (spec M12, T6.5).
 *
 * Two distinctions this screen must not blur: a file that expired on schedule
 * is not a file that failed, and a report with omissions is not a complete one.
 */
final class ExportsAPITests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder.klinik.decode(type, from: Data(json.utf8))
    }

    func testKnowsWhenToKeepAsking() throws {
        let queued = try decode(
            ExportRequest.self,
            #"""
            {"id":"e1","kind":"PATIENT_SUMMARY","status":"QUEUED","patientId":"p1",
             "size":null,"contents":null,"error":null,"expiresAt":null,
             "createdAt":"2026-03-02T09:00:00.000Z"}
            """#
        )

        XCTAssertTrue(queued.status.isPending)
        XCTAssertFalse(queued.isReady)
        XCTAssertNil(queued.contents)
    }

    func testAReadyExportCarriesItsManifest() throws {
        let ready = try decode(
            ExportRequest.self,
            #"""
            {"id":"e1","kind":"PATIENT_SUMMARY","status":"DONE","patientId":"p1","size":21612,
             "contents":{"surgeries":1,"measurementSeries":2,"labs":4,"medications":3,
                         "photos":0,"aiReports":1,"omissions":[]},
             "error":null,"expiresAt":"2099-03-09T09:00:00.000Z",
             "createdAt":"2026-03-02T09:00:00.000Z"}
            """#
        )

        XCTAssertTrue(ready.isReady)
        XCTAssertFalse(ready.status.isPending)
        XCTAssertTrue(ready.contents!.isComplete)
        XCTAssertEqual(ready.contents!.labs, 4)
        XCTAssertEqual(ready.size, 21612)
    }

    /**
     * The distinction that matters most here.
     *
     * A file produced, delivered and then cleaned up on schedule is a success.
     * Showing it as an error sends somebody looking for a fault that is not
     * there.
     */
    func testExpiredIsNotFailed() throws {
        let expired = try decode(
            ExportRequest.self,
            #"""
            {"id":"e1","kind":"PATIENT_SUMMARY","status":"DONE","patientId":"p1","size":21612,
             "contents":{"surgeries":0,"measurementSeries":0,"labs":0,"medications":0,
                         "photos":0,"aiReports":0,"omissions":[]},
             "error":null,"expiresAt":"2020-03-09T09:00:00.000Z",
             "createdAt":"2020-03-02T09:00:00.000Z"}
            """#
        )

        XCTAssertTrue(expired.hasExpired)
        XCTAssertFalse(expired.isReady)
        XCTAssertNotEqual(expired.status, .failed)
        XCTAssertEqual(expired.statusText, L10n.string("export.expired"))
    }

    func testAFailureCarriesItsReason() throws {
        let failed = try decode(
            ExportRequest.self,
            #"""
            {"id":"e1","kind":"PATIENT_SUMMARY","status":"FAILED","patientId":"p1","size":null,
             "contents":null,"error":"Patient not found","expiresAt":null,
             "createdAt":"2026-03-02T09:00:00.000Z"}
            """#
        )

        XCTAssertEqual(failed.error, "Patient not found")
        XCTAssertFalse(failed.status.isPending)
        XCTAssertFalse(failed.hasExpired)
    }

    /** A report with omissions is not a complete report, and says which. */
    func testOmissionsAreReadableRatherThanCodes() throws {
        let contents = try decode(
            ExportContents.self,
            #"""
            {"surgeries":1,"measurementSeries":0,"labs":2,"medications":0,"photos":0,"aiReports":0,
             "omissions":[{"section":"labs","reason":"lab-unverified","count":3},
                          {"section":"photos","reason":"photo-no-consent","count":2}]}
            """#
        )

        XCTAssertFalse(contents.isComplete)

        let note = contents.omissions![0].localizedNote
        XCTAssertTrue(note.contains("3"))
        XCTAssertFalse(note.contains("{count}"))
        XCTAssertNotEqual(note, "export.omission.lab-unverified")
    }

    func testHasWordingForEveryOmissionReason() {
        for reason in ["lab-unverified", "photo-no-consent", "photo-not-requested", "ai-unreviewed"] {
            let key = "export.omission.\(reason)"
            XCTAssertNotEqual(L10n.string(key), key)
        }
    }

    func testADownloadLinkKnowsWhenItHasLapsed() throws {
        let fresh = try decode(
            ExportDownload.self,
            #"""
            {"url":"https://example.invalid/x?X-Amz-Signature=abc",
             "expiresAt":"2099-01-01T00:00:00.000Z","filename":"hasta-ozeti-0a1b2c3d.pdf"}
            """#
        )
        let stale = try decode(
            ExportDownload.self,
            #"""
            {"url":"https://example.invalid/x?X-Amz-Signature=abc",
             "expiresAt":"2020-01-01T00:00:00.000Z","filename":"hasta-ozeti-0a1b2c3d.pdf"}
            """#
        )

        XCTAssertTrue(fresh.isStillValid)
        XCTAssertFalse(stale.isStillValid)
        XCTAssertTrue(fresh.filename.hasSuffix(".pdf"))
    }

    func testHasAWordForEveryStatus() {
        for status in ExportStatus.allCases {
            XCTAssertNotEqual(status.localizedName, "export.status.\(status.rawValue)")
        }
    }

    // MARK: - Bulk lists

    func testABulkListCarriesItsOwnManifest() throws {
        let list = try decode(
            ExportRequest.self,
            #"""
            {"id":"e2","kind":"PATIENT_LIST","status":"DONE","patientId":null,"size":4096,
             "contents":{"format":"CSV","columns":["mrn","country"],"rows":120,"matched":120,
                         "truncated":false,"groups":["identity"],"filter":{"country":"DE"}},
             "error":null,"expiresAt":"2099-03-09T09:00:00.000Z",
             "createdAt":"2026-03-02T09:00:00.000Z"}
            """#
        )

        XCTAssertEqual(list.kind, .patientList)
        XCTAssertNil(list.patientId)
        XCTAssertEqual(list.contents?.format, .csv)
        XCTAssertEqual(list.contents?.rows, 120)
        XCTAssertTrue(list.contents!.isComplete)
        XCTAssertNil(list.contents?.truncationNotice)
    }

    /**
     * A spreadsheet that stops short and does not say so is the one nobody
     * catches: it looks exactly like a complete one, and it will be summed.
     */
    func testATruncatedListSaysSo() throws {
        let list = try decode(
            ExportRequest.self,
            #"""
            {"id":"e2","kind":"PATIENT_LIST","status":"DONE","patientId":null,"size":4096,
             "contents":{"format":"XLSX","columns":["mrn"],"rows":100000,"matched":250000,
                         "truncated":true},
             "error":null,"expiresAt":"2099-03-09T09:00:00.000Z",
             "createdAt":"2026-03-02T09:00:00.000Z"}
            """#
        )

        XCTAssertFalse(list.contents!.isComplete)

        let notice = list.contents!.truncationNotice
        XCTAssertNotNil(notice)
        XCTAssertTrue(notice!.contains("100000"))
        XCTAssertTrue(notice!.contains("250000"))
        XCTAssertFalse(notice!.contains("{rows}"))
    }

    func testTheColumnCatalogueMarksWhatIsOutOfReach() throws {
        let columns = try decode(
            [ExportColumn].self,
            #"""
            [{"key":"mrn","header":"Dosya no","group":"identity",
              "permission":"patients.read","available":true},
             {"key":"balance","header":"Kalan","group":"finance",
              "permission":"finance.report","available":false}]
            """#
        )

        // Shown as unavailable rather than hidden: a column simply missing from
        // the list looks like one that does not exist, and somebody will go
        // looking for the data somewhere less careful.
        XCTAssertEqual(columns.count, 2)
        XCTAssertFalse(columns[1].available)
        XCTAssertEqual(columns[1].group, "finance")
        XCTAssertNotEqual(L10n.string("export.columnUnavailable"), "export.columnUnavailable")
    }

    func testCarriesTheWarningAboutPhotographs() {
        XCTAssertNotEqual(L10n.string("export.photoWarning"), "export.photoWarning")
        XCTAssertNotEqual(L10n.string("export.linkShortLived"), "export.linkShortLived")
    }
}

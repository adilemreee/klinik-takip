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

        let note = contents.omissions[0].localizedNote
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

    func testCarriesTheWarningAboutPhotographs() {
        XCTAssertNotEqual(L10n.string("export.photoWarning"), "export.photoWarning")
        XCTAssertNotEqual(L10n.string("export.linkShortLived"), "export.linkShortLived")
    }
}

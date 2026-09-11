import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikPhotosFeature

private actor RecordingTransport: HTTPTransport {
    private var bodies: [String: (Int, String)]
    private(set) var calls: [String] = []

    init(bodies: [String: (Int, String)]) {
        self.bodies = bodies
    }

    func setBody(_ key: String, _ value: (Int, String)) {
        bodies[key] = value
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        calls.append(key)

        guard let (status, body) = bodies[key] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func made() -> [String] { calls }
}

private struct FailingTransport: HTTPTransport {
    let error: APIError
    func send(_ request: URLRequest) async throws -> HTTPResponse { throw error }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

final class PhotoGalleryModelTests: XCTestCase {
    private func photo(
        _ id: String,
        area: String = "burun",
        phase: String = "pre-op",
        takenAt: String = "2026-01-01T08:00:00.000Z",
        consent: String = "null",
        aiReviewSuggested: String = "null",
        aiFindings: String = "[]"
    ) -> String {
        """
        {"id":"\(id)","category":"BEFORE","bodyArea":"\(area)","phaseLabel":"\(phase)",
         "mime":"image/jpeg","size":1024,"takenAt":"\(takenAt)","exifStripped":true,
         "isFaceBlurred":false,"consentId":\(consent),"note":null,
         "aiReviewSuggested":\(aiReviewSuggested),"aiFindings":\(aiFindings),
         "aiAssessedAt":null}
        """
    }

    private func group(_ area: String, _ photos: [String]) -> String {
        "{\"bodyArea\":\"\(area)\",\"photos\":[\(photos.joined(separator: ","))]}"
    }

    /// A client over one transport, for the tests that build their own model.
    private func client(_ transport: HTTPTransport) async -> APIClient {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        try? await session.signIn(
            with: SessionTokens(
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: Date().addingTimeInterval(900)
            )
        )

        return APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )
    }

    private func model(_ transport: HTTPTransport) async -> PhotoGalleryModel {
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
            transport: transport,
            session: session
        )
        return PhotoGalleryModel(api: PhotosAPI(client: client), subject: .patient(id: "p1"))
    }

    func testLoadsTheGalleryGroupedByBodyArea() async {
        let gallery = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/photos": (
                    200,
                    "[\(group("abdomen", [photo("a1", area: "abdomen")])),\(group("burun", [photo("b1")]))]"
                ),
            ])
        )

        await gallery.load()

        let state = await gallery.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.groups.map(\.bodyArea), ["abdomen", "burun"])
        XCTAssertEqual(state.selectedGroup?.bodyArea, "abdomen")
    }

    /// No photos yet is not a failure and must not be shown as one.
    func testReportsEmptySeparatelyFromFailure() async {
        let gallery = await model(
            RecordingTransport(bodies: ["GET /patients/p1/photos": (200, "[]")])
        )

        await gallery.load()

        let phase = await gallery.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    /**
     * The comparison opens on the earliest and the latest of the selected area
     * — the two shots between which something changed.
     */
    func testComparisonPairsTheEarliestWithTheLatest() async {
        let gallery = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/photos": (
                    200,
                    "[\(group("burun", [photo("b1", takenAt: "2026-01-01T08:00:00.000Z"), photo("b2", takenAt: "2026-02-01T08:00:00.000Z"), photo("b3", takenAt: "2026-03-01T08:00:00.000Z")]))]"
                ),
            ])
        )

        await gallery.load()

        let comparison = await gallery.currentState().comparison

        XCTAssertEqual(comparison?.before.id, "b1")
        XCTAssertEqual(comparison?.after.id, "b3")
    }

    /**
     * A slider over one image does nothing, and offering it suggests there is a
     * change to see.
     */
    func testOffersNoComparisonForASinglePhoto() async {
        let gallery = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/photos": (200, "[\(group("burun", [photo("b1")]))]"),
            ])
        )

        await gallery.load()

        let comparison = await gallery.currentState().comparison
        XCTAssertNil(comparison)
    }

    func testSwitchesBodyArea() async {
        let gallery = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/photos": (
                    200,
                    "[\(group("abdomen", [photo("a1", area: "abdomen")])),\(group("burun", [photo("b1")]))]"
                ),
            ])
        )

        await gallery.load()
        await gallery.select(area: "burun")

        let selected = await gallery.currentState().selectedGroup?.bodyArea
        XCTAssertEqual(selected, "burun")
    }

    /**
     * Whether a photo may be used outside the clinic is a fact about the image,
     * and the screen shows it on the image.
     */
    func testCarriesWhetherUsageConsentWasGiven() async {
        let gallery = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/photos": (
                    200,
                    "[\(group("burun", [photo("b1", consent: "\"c1\""), photo("b2")]))]"
                ),
            ])
        )

        await gallery.load()

        let photos = await gallery.currentState().selectedGroup?.photos

        XCTAssertEqual(photos?[0].hasUsageConsent, true)
        XCTAssertEqual(photos?[1].hasUsageConsent, false)
    }

    /**
     * The overlay endpoint answers with an empty object when there is nothing
     * to line up against, which must decode as "none" rather than as a failure.
     */
    func testReportsNoOverlayReferenceForAFirstPhoto() async {
        let gallery = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/photos/overlay": (200, "{}"),
            ])
        )

        let reference = await gallery.overlayReference(bodyArea: "kol")
        XCTAssertNil(reference)
    }

    func testReturnsTheOverlayReferenceWhenThereIsOne() async {
        let gallery = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/photos/overlay": (200, photo("b9")),
            ])
        )

        let reference = await gallery.overlayReference(bodyArea: "burun")
        XCTAssertEqual(reference?.id, "b9")
    }

    /**
     * The server refuses a format whose location data it cannot strip and says
     * so; replacing that with our own message leaves the person guessing why a
     * perfectly good photo was rejected.
     */
    func testKeepsTheServerMessageWhenAnUploadIsRefused() async throws {
        let scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("klinik-photo-\(UUID().uuidString).jpg")
        try Data([0xff, 0xd8, 0xff]).write(to: scratch)
        defer { try? FileManager.default.removeItem(at: scratch) }

        let gallery = await model(
            FailingTransport(
                error: .validation(
                    ErrorResponse(
                        statusCode: 400,
                        message: "Photos must be JPEG or PNG; image/heic cannot have its location data removed"
                    )
                )
            )
        )

        let uploaded = await gallery.upload(
            fileURL: scratch,
            category: .wound,
            bodyArea: "abdomen",
            phaseLabel: "post-op D1"
        )

        let error = await gallery.currentState().error

        XCTAssertFalse(uploaded)
        XCTAssertEqual(
            error,
            "Photos must be JPEG or PNG; image/heic cannot have its location data removed"
        )
    }

    func testTreatsNotFoundAsItsOwnState() async {
        let gallery = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await gallery.load()

        let phase = await gallery.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }

    /// A real file on disk. The multipart body is assembled before the request
    /// is made, so a path that does not exist fails before the transport is
    /// ever asked — which is a different failure from the one under test.
    private func temporaryJPEG() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")

        try Data([0xFF, 0xD8, 0xFF, 0xE0] + Array(repeating: 0x11, count: 64)).write(to: url)

        return url
    }

    // MARK: - Offline (spec M15)

    /**
     * A wound photograph taken where there is no signal.
     *
     * Documents queued; photographs did not. A post-operative patient in a
     * hotel photographing a wound is the exact case this product exists for,
     * and it ended with a red message and nothing kept.
     */
    func testAPhotographIsKeptWhenTheConnectionCannotCarryIt() async throws {
        let file = try temporaryJPEG()
        defer { try? FileManager.default.removeItem(at: file) }

        let queue = RecordingUploadQueue()
        let model = PhotoGalleryModel(
            api: PhotosAPI(client: await client(FailingTransport(error: .offline))),
            subject: .me,
            queue: queue
        )

        let sent = await model.upload(
            fileURL: file,
            category: .wound,
            bodyArea: "karın",
            phaseLabel: nil
        )

        // True: from the patient's side the photograph *is* taken. What is
        // outstanding is the delivery, and the screen says so.
        XCTAssertTrue(sent)

        let state = await model.currentState()
        XCTAssertTrue(state.queued)
        XCTAssertNil(state.error)

        let kept = await queue.photographs()
        XCTAssertEqual(kept.count, 1)
        XCTAssertEqual(kept.first?.fields["category"], "WOUND")
        XCTAssertEqual(kept.first?.fields["bodyArea"], "karın")
    }

    /// With no queue attached the failure is reported exactly as before.
    func testWithoutAQueueTheFailureIsStillReported() async throws {
        let file = try temporaryJPEG()
        defer { try? FileManager.default.removeItem(at: file) }

        let model = PhotoGalleryModel(
            api: PhotosAPI(client: await client(FailingTransport(error: .offline))),
            subject: .me
        )

        let sent = await model.upload(
            fileURL: file,
            category: .wound,
            bodyArea: nil,
            phaseLabel: nil
        )

        XCTAssertFalse(sent)

        let state = await model.currentState()
        XCTAssertFalse(state.queued)
        XCTAssertNotNil(state.error)
    }

    /**
     * A refusal is not a connection problem.
     *
     * The server turns down a format whose location data it cannot strip, and
     * queueing that would mean retrying it forever against an answer that will
     * not change.
     */
    func testARefusedPhotographIsNotQueued() async throws {
        let file = try temporaryJPEG()
        defer { try? FileManager.default.removeItem(at: file) }

        let queue = RecordingUploadQueue()
        let model = PhotoGalleryModel(
            api: PhotosAPI(
                client: await client(RecordingTransport(bodies: [:]))
            ),
            subject: .me,
            queue: queue
        )

        let sent = await model.upload(
            fileURL: file,
            category: .wound,
            bodyArea: nil,
            phaseLabel: nil
        )

        XCTAssertFalse(sent)

        let kept = await queue.photographs()
        XCTAssertTrue(kept.isEmpty)
    }
}

/**
 * The pre-assessment flag, as the clinician's screen sees it (spec M5).
 *
 * Three states, and the difference between two of them is the whole point:
 * nobody has looked, somebody looked and found nothing, and somebody should
 * look.
 */
final class PhotoAssessmentRenderingTests: XCTestCase {
    private func decode(_ json: String) throws -> ClinicalPhoto {
        try JSONDecoder.klinik.decode(ClinicalPhoto.self, from: Data(json.utf8))
    }

    private func photoJSON(reviewSuggested: String, findings: String) -> String {
        """
        {"id":"p1","category":"COMPLICATION","bodyArea":"abdomen","phaseLabel":null,
         "mime":"image/jpeg","size":1024,"takenAt":"2026-03-01T08:00:00.000Z",
         "exifStripped":true,"isFaceBlurred":false,"consentId":null,"note":null,
         "aiReviewSuggested":\(reviewSuggested),"aiFindings":\(findings),
         "aiAssessedAt":"2026-03-01T09:00:00.000Z"}
        """
    }

    func testTellsApartNotLookedFromLookedAndClean() throws {
        let unassessed = try decode(photoJSON(reviewSuggested: "null", findings: "[]"))
        let clean = try decode(photoJSON(reviewSuggested: "false", findings: "[]"))

        XCTAssertFalse(unassessed.needsReview)
        XCTAssertFalse(unassessed.isAssessedClean)

        XCTAssertFalse(clean.needsReview)
        // Somebody looked and found nothing, which is not the same as nobody
        // having looked.
        XCTAssertTrue(clean.isAssessedClean)
    }

    func testMarksAPhotoAClinicianShouldOpen() throws {
        let flagged = try decode(
            photoJSON(reviewSuggested: "true", findings: "[\"redness\",\"discharge\"]")
        )

        XCTAssertTrue(flagged.needsReview)
        XCTAssertEqual(flagged.aiFindings, ["redness", "discharge"])
    }

    /** The model never writes the words a clinician reads. */
    func testRendersTheFindingsFromTheCatalogueRatherThanTheModel() throws {
        let flagged = try decode(
            photoJSON(reviewSuggested: "true", findings: "[\"redness\",\"wound-open\"]")
        )

        let rendered = flagged.localizedFindings

        XCTAssertEqual(rendered.count, 2)
        for text in rendered {
            XCTAssertFalse(text.isEmpty)
            XCTAssertFalse(text.hasPrefix("photo.finding."))
        }
    }

    func testHasAWordForEveryFindingTheServerCanSend() {
        for finding in ["redness", "discharge", "swelling", "wound-open"] {
            let text = L10n.string("photo.finding.\(finding)")

            XCTAssertNotEqual(text, "photo.finding.\(finding)")
            XCTAssertFalse(text.isEmpty)
        }
    }

}

/// What the model handed the queue.
private actor RecordingUploadQueue: PendingUploadQueue {
    struct Kept {
        let subject: RecordSubject
        let fields: [String: String]
    }

    private var kept: [Kept] = []

    func keep(
        fileURL: URL,
        subject: RecordSubject,
        type: DocumentType,
        contentType: String,
        originalName: String?,
        sessionId: String?
    ) async throws {
        XCTFail("A photograph must not be queued as a document")
    }

    func keepPhoto(
        fileURL: URL,
        subject: RecordSubject,
        contentType: String,
        fields: [String: String]
    ) async throws {
        kept.append(Kept(subject: subject, fields: fields))
    }

    func photographs() -> [Kept] { kept }
}

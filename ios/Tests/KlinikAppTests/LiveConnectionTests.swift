import XCTest
import KlinikAPI
@testable import KlinikApp

/**
 * Reading what the socket hands over.
 *
 * The library delivers `[Any]` from JSON, and the failure worth guarding is
 * the quiet one: a payload that decodes into a half-filled message would put a
 * blank row in a clinician's thread rather than nothing at all.
 */
final class LiveConnectionTests: XCTestCase {
    private let message = """
    {"id":"m1","conversationId":"c1","senderId":"u1","type":"TEXT","body":"Merhaba",\
    "transcript":null,"status":"SENT","queuedUntil":null,"readAt":null,"triageLevel":null,\
    "triageFlags":[],"aiTriageLevel":null,"aiSummary":null,"createdAt":"2026-01-02T08:00:00.000Z"}
    """

    private func payload(_ json: String) -> [Any] {
        [try! JSONSerialization.jsonObject(with: Data(json.utf8))]
    }

    func testAMessagePayloadDecodes() throws {
        let decoded = LiveConnection.decode(ChatMessage.self, from: payload(message))

        XCTAssertEqual(decoded?.id, "m1")
        XCTAssertEqual(decoded?.conversationId, "c1")
        XCTAssertEqual(decoded?.body, "Merhaba")
    }

    /// Half a message is not a message. Better nothing than a blank row in a
    /// clinician's thread.
    func testAnIncompletePayloadIsRefused() {
        XCTAssertNil(
            LiveConnection.decode(ChatMessage.self, from: payload(#"{"id":"m1"}"#))
        )
    }

    func testAnEmptyPayloadIsRefused() {
        XCTAssertNil(LiveConnection.decode(ChatMessage.self, from: []))
    }

    /// socket.io can deliver a bare string where an object was expected.
    func testANonObjectPayloadIsRefused() {
        XCTAssertNil(LiveConnection.decode(ChatMessage.self, from: ["not an object"]))
    }

    func testTheDateFormatMatchesTheRestOfTheClient() throws {
        let decoded = try XCTUnwrap(LiveConnection.decode(ChatMessage.self, from: payload(message)))

        // The same instant the REST decoder would produce, which is what stops
        // a socket message sorting into the wrong place in the thread.
        XCTAssertEqual(
            decoded.createdAt.timeIntervalSince1970,
            Date(timeIntervalSince1970: 1_767_340_800).timeIntervalSince1970,
            accuracy: 1
        )
    }
}

/**
 * Job progress over the socket (spec M14).
 *
 * A courtesy on top of a screen that already polls, so the rule is about not
 * making things worse: a payload that cannot be trusted must not reach a
 * screen, and an unknown status must not colour a row by a state nobody
 * defined.
 */
final class JobUpdateTests: XCTestCase {
    private func payload(_ json: String) -> [Any] {
        [try! JSONSerialization.jsonObject(with: Data(json.utf8))]
    }

    private let done = """
    {"jobId":"j1","patientId":"p1","entityType":"documents","entityId":"d1",\
    "queue":"documents","name":"intake","status":"DONE","error":null}
    """

    func testASettledJobDecodes() throws {
        let update = try XCTUnwrap(LiveConnection.decode(JobUpdate.self, from: payload(done)))

        XCTAssertEqual(update.jobId, "j1")
        XCTAssertEqual(update.patientId, "p1")
        XCTAssertEqual(update.entityId, "d1")
        XCTAssertTrue(update.isSettled)
    }

    /// A row moving from queued to processing changes nothing the list shows,
    /// and the screen uses this to decide whether to spend a request.
    func testWorkStillRunningIsNotSettled() throws {
        let running = done.replacingOccurrences(of: "\"DONE\"", with: "\"PROCESSING\"")
        let update = try XCTUnwrap(LiveConnection.decode(JobUpdate.self, from: payload(running)))

        XCTAssertFalse(update.isSettled)
    }

    func testAFailedJobCarriesItsReason() throws {
        let failed = done
            .replacingOccurrences(of: "\"DONE\"", with: "\"FAILED\"")
            .replacingOccurrences(of: "\"error\":null", with: "\"error\":\"Okunamadı\"")

        let update = try XCTUnwrap(LiveConnection.decode(JobUpdate.self, from: payload(failed)))

        XCTAssertEqual(update.error, "Okunamadı")
        XCTAssertTrue(update.isSettled)
    }

    func testAnUnknownStatusIsRefused() {
        let strange = done.replacingOccurrences(of: "\"DONE\"", with: "\"EXPLODED\"")

        XCTAssertNil(LiveConnection.decode(JobUpdate.self, from: payload(strange)))
    }

    func testAnIncompletePayloadIsRefused() {
        XCTAssertNil(LiveConnection.decode(JobUpdate.self, from: payload(#"{"jobId":"j1"}"#)))
    }

    /**
     * Reconnection backs off, and starts over once a connection sticks.
     *
     * Reconnecting is this type's own job now, because socket.io's replays the
     * handshake headers it was built with — and the access token in them is
     * exactly the thing that goes stale. The connection used to work for an
     * hour and then go quiet until the app was restarted.
     */
    func testReconnectionBacksOffAndIsCapped() {
        XCTAssertEqual(LiveConnection.backoff(afterFailures: 0), 2)
        XCTAssertEqual(LiveConnection.backoff(afterFailures: 1), 4)
        XCTAssertEqual(LiveConnection.backoff(afterFailures: 2), 8)

        // Capped: a clinic behind a proxy that refuses the upgrade must not be
        // asked twice a second all day.
        XCTAssertEqual(LiveConnection.backoff(afterFailures: 10), 30)
        XCTAssertLessThanOrEqual(LiveConnection.backoff(afterFailures: 1_000), 30)
    }

    /// The first attempt waits, rather than hammering the moment a connection
    /// drops — a dropped socket is usually a connection that is still going.
    func testTheFirstRetryIsNotImmediate() {
        XCTAssertGreaterThan(LiveConnection.backoff(afterFailures: 0), 0)
    }
}

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

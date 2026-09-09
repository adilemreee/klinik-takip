import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikSync

/**
 * How the queue reads the server's answer to a replay.
 *
 * The distinction that matters is between "try again later" and "a person has
 * to look at this". Getting it wrong in one direction hides a change that will
 * never be sent; in the other it interrupts somebody about a connection that
 * came back on its own.
 */
final class APIOutboxSenderTests: XCTestCase {
    private func body(_ json: String) -> Data { Data(json.utf8) }

    private func response(_ message: String) -> ErrorResponse {
        ErrorResponse(statusCode: 409, message: message)
    }

    func testNoConnectionIsWorthTryingAgain() {
        let outcome = APIOutboxSender.outcome(for: .offline, body: Data())

        guard case .retryable = outcome else {
            return XCTFail("Expected retryable, got \(outcome)")
        }
    }

    func testAServerErrorIsWorthTryingAgain() {
        let outcome = APIOutboxSender.outcome(
            for: .server(ErrorResponse(statusCode: 502, message: "")),
            body: Data()
        )

        guard case .retryable = outcome else {
            return XCTFail("Expected retryable, got \(outcome)")
        }
    }

    /// The server is still processing the first attempt. The phone gave up on
    /// a request the clinic did not — nothing here needs a person.
    func testAnAttemptStillRunningIsWaitedFor() {
        let outcome = APIOutboxSender.outcome(
            for: .conflict(response("IDEMPOTENCY_IN_FLIGHT")),
            body: body(#"{"statusCode":409,"message":"IDEMPOTENCY_IN_FLIGHT"}"#)
        )

        guard case .retryable = outcome else {
            return XCTFail("Expected retryable, got \(outcome)")
        }
    }

    func testAVersionConflictKeepsBothSides() {
        let outcome = APIOutboxSender.outcome(
            for: .conflict(response("VERSION_CONFLICT")),
            body: body(
                #"{"statusCode":409,"message":"VERSION_CONFLICT","currentVersion":4,"current":{"city":"Hamburg"}}"#
            )
        )

        guard case .conflict(let record, let version) = outcome else {
            return XCTFail("Expected a conflict, got \(outcome)")
        }

        XCTAssertEqual(version, 4)

        let parsed = try? JSONSerialization.jsonObject(with: record) as? [String: String]
        XCTAssertEqual(parsed, ["city": "Hamburg"])
    }

    /// A questionnaire already answered, a payment already reversed. Retrying
    /// will not change it, so the user is told rather than kept waiting.
    func testAnyOther409IsSomethingThePersonMustSee() {
        let outcome = APIOutboxSender.outcome(
            for: .conflict(response("Bu anket zaten yanıtlanmış")),
            body: body(#"{"statusCode":409,"message":"Bu anket zaten yanıtlanmış"}"#)
        )

        guard case .rejected(let message) = outcome else {
            return XCTFail("Expected rejected, got \(outcome)")
        }

        XCTAssertEqual(message, "Bu anket zaten yanıtlanmış")
    }

    /// A conflict body we cannot read is still a refusal — it must not be
    /// swallowed as "sent".
    func testAConflictWithNothingReadableInItIsStillRefused() {
        let outcome = APIOutboxSender.outcome(
            for: .conflict(response("VERSION_CONFLICT")),
            body: Data()
        )

        guard case .rejected = outcome else {
            return XCTFail("Expected rejected, got \(outcome)")
        }
    }

    func testAValidationFailureWillNeverSucceed() {
        let outcome = APIOutboxSender.outcome(
            for: .validation(ErrorResponse(statusCode: 400, message: "Kilo 500 kg olamaz")),
            body: Data()
        )

        guard case .rejected(let message) = outcome else {
            return XCTFail("Expected rejected, got \(outcome)")
        }

        XCTAssertEqual(message, "Kilo 500 kg olamaz")
    }
}

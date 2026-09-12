import XCTest
@testable import KlinikCore

/**
 * Telling somebody they have no permission is a claim about them.
 *
 * Four screens fired three or four best-effort reads and, when none of them
 * came back, said "this account has no access to this screen". That is true of
 * a 403 and of nothing else: an unreachable clinic, a 500, or a response the
 * app could not parse all read the same way, and the screen offered no retry —
 * so a finance officer was sent to ask for a permission they already had.
 */
final class ReadOutcomeTests: XCTestCase {
    private let refused = APIError.forbidden(ErrorResponse(statusCode: 403, message: "forbidden"))

    func testEveryFailureBeingARefusalIsARefusal() {
        XCTAssertEqual(ReadOutcome.of([refused, refused]), .refused)
    }

    /// One read that failed for another reason is enough: the screen says what
    /// went wrong and offers to try again.
    func testOneOrdinaryFailureMakesItAFailure() {
        guard case .failed(let message) = ReadOutcome.of([refused, .offline]) else {
            return XCTFail("expected a failure, not a refusal")
        }

        XCTAssertEqual(message, L10n.string("error.offline"))
    }

    /// The reason shown is the one that is not a refusal, wherever it sits.
    func testTheReasonShownIsTheOneWorthActingOn() {
        guard case .failed(let message) = ReadOutcome.of([refused, refused, .timedOut]) else {
            return XCTFail("expected a failure, not a refusal")
        }

        XCTAssertEqual(message, L10n.string("error.timedOut"))
    }

    /// A response the app cannot parse is a fault at one end or the other, and
    /// never evidence about what the reader is allowed to see.
    func testADecodingFailureIsNotARefusal() {
        guard case .failed = ReadOutcome.of([.decoding("age")]) else {
            return XCTFail("a decode failure is not a permission problem")
        }
    }

    func testAttemptKeepsTheReason() async {
        let outcome: Attempted<Int> = await attempt { throw APIError.offline }

        XCTAssertNil(outcome.value)
        XCTAssertEqual(outcome.error, .offline)
    }

    func testAttemptCarriesTheValueThrough() async {
        let outcome = await attempt { 7 }

        XCTAssertEqual(outcome.value, 7)
        XCTAssertNil(outcome.error)
    }
}

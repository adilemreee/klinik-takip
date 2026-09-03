import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * The assistant, as the patient's screen sees it.
 *
 * The client's job is small and one part of it matters: whichever way the
 * server went, there is something to show — and when a person is answering, the
 * patient is told that rather than shown an empty bubble.
 */
final class AssistantAPITests: XCTestCase {
    private func decode(_ json: String) throws -> AssistantResult {
        try JSONDecoder.klinik.decode(AssistantResult.self, from: Data(json.utf8))
    }

    func testReadsAnAnswerWithItsSources() throws {
        let result = try decode(
            """
            {"questionMessageId":"m1","answered":true,
             "answer":"Pansumanınızı günde bir kez değiştirin.\\n\\nKaynak: Yara Bakımı",
             "sources":["Yara Bakımı"],"handoverReason":null}
            """
        )

        XCTAssertTrue(result.answered)
        XCTAssertEqual(result.sources, ["Yara Bakımı"])
        XCTAssertTrue(result.displayText.contains("günde bir kez"))
    }

    func testReadsAHandoverAndStillHasSomethingToShow() throws {
        let result = try decode(
            """
            {"questionMessageId":"m1","answered":false,"answer":null,
             "sources":[],"handoverReason":"no-sources"}
            """
        )

        XCTAssertFalse(result.answered)
        XCTAssertEqual(result.handoverReason, .noSources)
        // Never an empty bubble.
        XCTAssertFalse(result.displayText.isEmpty)
        XCTAssertNotEqual(result.displayText, "assistant.handover")
    }

    /**
     * Every handover reads the same to the patient. Explaining which internal
     * check declined would invite rephrasing until the bot answers, which is
     * the opposite of what those checks are for.
     */
    func testEveryHandoverReasonSaysTheSameThingToThePatient() {
        let messages = Set(
            [HandoverReason.noSources, .modelDeclined, .noCitations, .aiUnavailable]
                .map(\.localizedMessage)
        )

        XCTAssertEqual(messages.count, 1)
        XCTAssertFalse(messages.first!.isEmpty)
    }

    func testKeepsTheQuestionHandleSoItCanBeEscalated() throws {
        let result = try decode(
            """
            {"questionMessageId":"m-42","answered":true,"answer":"Evet.",
             "sources":["SSS"],"handoverReason":null}
            """
        )

        XCTAssertEqual(result.questionMessageId, "m-42")
    }
}

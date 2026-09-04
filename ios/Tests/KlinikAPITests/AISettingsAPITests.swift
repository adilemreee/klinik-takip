import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * Choosing the AI provider (spec 3.4, 14.5).
 *
 * The two properties a settings screen must not blur: the key is write-only,
 * and "the provider works" is not "the provider may see patient data".
 */
final class AISettingsAPITests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder.klinik.decode(type, from: Data(json.utf8))
    }

    private let configured = #"""
    {"provider":"anthropic","model":"claude-sonnet-5","apiKeyLast4":"1234","hasApiKey":true,
     "inputPricePerMTok":"3.00","outputPricePerMTok":"15.00",
     "zeroRetentionConfirmed":true,"zeroRetentionNote":"BAA 2026-09-01",
     "zeroRetentionAt":"2026-09-01T09:00:00.000Z","monthlyBudgetUsd":"200.00",
     "ready":true,"missing":[],"updatedAt":"2026-09-04T09:00:00.000Z"}
    """#

    func testTheKeyIsOnlyEverFourCharacters() throws {
        let settings = try decode(AISettings.self, configured)

        XCTAssertTrue(settings.hasApiKey)
        XCTAssertEqual(settings.apiKeyLast4, "1234")
        // There is no field to read it back, because there is no endpoint that
        // returns it.
        XCTAssertEqual(settings.apiKeyLast4?.count, 4)
    }

    /**
     * The distinction that matters most on this screen.
     *
     * A provider with a working key still refuses every clinical prompt until
     * somebody has declared the retention terms. Showing only `ready` would
     * tell an administrator they had finished while the interesting half of
     * the system was still off.
     */
    func testReadyToRunIsNotReadyForClinicalWork() throws {
        let withDeclaration = try decode(AISettings.self, configured)
        let without = try decode(
            AISettings.self,
            #"""
            {"provider":"deepseek","model":"deepseek-chat","apiKeyLast4":"9999","hasApiKey":true,
             "inputPricePerMTok":"0.30","outputPricePerMTok":"1.20",
             "zeroRetentionConfirmed":false,"zeroRetentionNote":null,"zeroRetentionAt":null,
             "monthlyBudgetUsd":null,"ready":true,"missing":[],
             "updatedAt":"2026-09-04T09:00:00.000Z"}
            """#
        )

        XCTAssertTrue(withDeclaration.readyForClinicalUse)
        XCTAssertTrue(without.ready)
        XCTAssertFalse(without.readyForClinicalUse)
        XCTAssertNotEqual(
            L10n.string("ai.settings.notClinicalReady"),
            "ai.settings.notClinicalReady"
        )
    }

    func testSaysWhatIsMissingInWordsRatherThanFieldNames() throws {
        let partial = try decode(
            AISettings.self,
            #"""
            {"provider":"gemini","model":null,"apiKeyLast4":null,"hasApiKey":false,
             "inputPricePerMTok":null,"outputPricePerMTok":null,
             "zeroRetentionConfirmed":false,"zeroRetentionNote":null,"zeroRetentionAt":null,
             "monthlyBudgetUsd":null,"ready":false,
             "missing":["model","apiKey","inputPricePerMTok","outputPricePerMTok"],
             "updatedAt":null}
            """#
        )

        XCTAssertFalse(partial.ready)
        XCTAssertEqual(partial.localizedMissing.count, 4)

        for (key, text) in zip(partial.missing, partial.localizedMissing) {
            XCTAssertNotEqual(text, "ai.missing.\(key)")
            XCTAssertFalse(text.isEmpty)
        }
    }

    func testAnUnconfiguredLayerReadsAsUnconfigured() throws {
        let empty = try decode(
            AISettings.self,
            #"""
            {"provider":null,"model":null,"apiKeyLast4":null,"hasApiKey":false,
             "inputPricePerMTok":null,"outputPricePerMTok":null,
             "zeroRetentionConfirmed":false,"zeroRetentionNote":null,"zeroRetentionAt":null,
             "monthlyBudgetUsd":null,"ready":false,"missing":["provider"],"updatedAt":null}
            """#
        )

        XCTAssertNil(empty.provider)
        XCTAssertFalse(empty.hasApiKey)
        XCTAssertFalse(empty.readyForClinicalUse)
    }

    func testReadsAllFourProvidersWithTheirWarnings() throws {
        let providers = try decode(
            [AIProviderInfo].self,
            #"""
            [{"id":"anthropic","label":"Anthropic (Claude)","models":["claude-sonnet-5"],
              "pricingUrl":"https://www.anthropic.com/pricing",
              "consoleUrl":"https://console.anthropic.com/","retentionNote":"n1"},
             {"id":"openai","label":"OpenAI (GPT)","models":["gpt-5"],
              "pricingUrl":"https://openai.com/api/pricing/",
              "consoleUrl":"https://platform.openai.com/api-keys","retentionNote":"n2"},
             {"id":"gemini","label":"Google (Gemini)","models":["gemini-2.5-pro"],
              "pricingUrl":"https://ai.google.dev/pricing",
              "consoleUrl":"https://aistudio.google.com/apikey","retentionNote":"n3"},
             {"id":"deepseek","label":"DeepSeek","models":["deepseek-chat"],
              "pricingUrl":"https://api-docs.deepseek.com/quick_start/pricing",
              "consoleUrl":"https://platform.deepseek.com/api_keys","retentionNote":"n4"}]
            """#
        )

        XCTAssertEqual(providers.map(\.id), AIProviderChoice.allCases)
        XCTAssertTrue(providers.allSatisfy { !$0.retentionNote.isEmpty })
        XCTAssertTrue(providers.allSatisfy { $0.consoleUrl.hasPrefix("https://") })
    }

    func testAConnectionTestReportsTheProvidersOwnWords() throws {
        let failed = try decode(
            AIConnectionTest.self,
            #"{"ok":false,"model":null,"error":"API key not valid"}"#
        )
        let worked = try decode(
            AIConnectionTest.self,
            #"{"ok":true,"model":"claude-sonnet-5-20260101","error":null}"#
        )

        XCTAssertFalse(failed.ok)
        XCTAssertEqual(failed.error, "API key not valid")
        // The version that answered, which is not always the one asked for.
        XCTAssertEqual(worked.model, "claude-sonnet-5-20260101")
        XCTAssertNil(worked.error)
    }

    func testCarriesTheWarningThatChangingProviderClearsTheDeclaration() {
        for key in [
            "ai.settings.apiKeyWriteOnly",
            "ai.settings.zeroRetentionCleared",
            "ai.settings.priceHint",
        ] {
            XCTAssertNotEqual(L10n.string(key), key)
        }
    }
}

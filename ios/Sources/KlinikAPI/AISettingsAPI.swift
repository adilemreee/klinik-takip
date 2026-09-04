import Foundation
import KlinikCore

/**
 * Choosing which model service the clinic uses (spec 3.4, 14.5).
 *
 * Two things this type is built to make hard to get wrong on a screen.
 *
 * The **key is write-only**. There is no field to read it back, because there
 * is no endpoint that returns it — a screen sees the last four characters,
 * which answers the only question it has: which key is in there.
 *
 * The **zero-retention declaration belongs to a provider**. Anthropic, OpenAI,
 * Google and DeepSeek do not offer the same terms, so switching provider clears
 * it and the clinic has to say it again about the new one. A screen that hides
 * that would be collecting consent nobody gave.
 */

public enum AIProviderChoice: String, Codable, Sendable, Equatable, CaseIterable {
    case anthropic
    case openai
    case gemini
    case deepseek
}

public struct AIProviderInfo: Decodable, Sendable, Equatable, Identifiable {
    public let id: AIProviderChoice
    public let label: String
    /// Suggested models. Not a closed list — a model released last week is fine.
    public let models: [String]
    /// Where the operator reads the current price.
    public let pricingUrl: String
    /// Where the operator gets a key.
    public let consoleUrl: String
    /**
     * What has to be satisfied before clinical prompts are allowed.
     *
     * Shown beside the confirmation box, not behind a link: a tick against an
     * unread sentence is not a record of anything.
     */
    public let retentionNote: String
}

public struct AISettings: Decodable, Sendable, Equatable {
    public let provider: AIProviderChoice?
    public let model: String?
    /// The last four characters. The key itself never leaves the server.
    public let apiKeyLast4: String?
    public let hasApiKey: Bool
    public let inputPricePerMTok: String?
    public let outputPricePerMTok: String?
    /// Applies to `provider`. Cleared whenever the provider changes.
    public let zeroRetentionConfirmed: Bool
    public let zeroRetentionNote: String?
    public let zeroRetentionAt: Date?
    public let monthlyBudgetUsd: String?
    /// Whether the AI layer would run with what is saved.
    public let ready: Bool
    /// What is missing, in the order somebody would fix it.
    public let missing: [String]
    public let updatedAt: Date?

    /**
     * Ready to run is not the same as ready for clinical work.
     *
     * Without the declaration the layer still refuses every clinical prompt —
     * so a screen showing only `ready` would tell somebody they were finished
     * when the interesting half of the system is still switched off.
     */
    public var readyForClinicalUse: Bool { ready && zeroRetentionConfirmed }

    public var localizedMissing: [String] {
        missing.map { L10n.string("ai.missing.\($0)") }
    }
}

public struct AIConnectionTest: Decodable, Sendable, Equatable {
    public let ok: Bool
    /// The version that actually answered, which is not always the one asked for.
    public let model: String?
    /// The provider's own words, truncated.
    public let error: String?
}

public struct AISettingsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// The four on offer, with where to get a key and what to check about each.
    public func providers() async throws -> [AIProviderInfo] {
        try await client.send(
            Endpoint(method: .get, path: "ai/providers"),
            as: [AIProviderInfo].self
        )
    }

    public func settings() async throws -> AISettings {
        try await client.send(Endpoint(method: .get, path: "ai/settings"), as: AISettings.self)
    }

    /**
     * Saves the choice. `apiKey` is write-only — omit it to leave the stored
     * key alone, which is what changing a price should do.
     */
    public func update(
        provider: AIProviderChoice? = nil,
        model: String? = nil,
        apiKey: String? = nil,
        inputPricePerMTok: String? = nil,
        outputPricePerMTok: String? = nil,
        monthlyBudgetUsd: String? = nil,
        zeroRetentionConfirmed: Bool? = nil,
        zeroRetentionNote: String? = nil
    ) async throws -> AISettings {
        try await client.send(
            Endpoint(
                method: .put,
                path: "ai/settings",
                body: try JSONEncoder.klinik.encode(
                    UpdateBody(
                        provider: provider,
                        model: model,
                        apiKey: apiKey,
                        inputPricePerMTok: inputPricePerMTok,
                        outputPricePerMTok: outputPricePerMTok,
                        monthlyBudgetUsd: monthlyBudgetUsd,
                        zeroRetentionConfirmed: zeroRetentionConfirmed,
                        zeroRetentionNote: zeroRetentionNote
                    )
                )
            ),
            as: AISettings.self
        )
    }

    /// Switches the AI layer off by forgetting the configuration.
    public func clear() async throws -> AISettings {
        try await client.send(Endpoint(method: .delete, path: "ai/settings"), as: AISettings.self)
    }

    /// Checks the saved key against the provider. Sends nothing clinical.
    public func test() async throws -> AIConnectionTest {
        try await client.send(
            Endpoint(method: .post, path: "ai/settings/test"),
            as: AIConnectionTest.self
        )
    }

    private struct UpdateBody: Encodable {
        let provider: AIProviderChoice?
        let model: String?
        let apiKey: String?
        let inputPricePerMTok: String?
        let outputPricePerMTok: String?
        let monthlyBudgetUsd: String?
        let zeroRetentionConfirmed: Bool?
        let zeroRetentionNote: String?
    }
}

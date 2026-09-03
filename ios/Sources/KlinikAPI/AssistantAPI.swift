import Foundation
import KlinikCore

/// Why a question went to a person instead of being answered.
public enum HandoverReason: String, Decodable, Sendable, Equatable {
    /// Nothing in the clinic's documents was about this.
    case noSources = "no-sources"
    /// The documents were retrieved, but the model said they do not answer it.
    case modelDeclined = "model-declined"
    /// The answer did not point at anything it was given, so it was discarded.
    case noCitations = "no-citations"
    case aiUnavailable = "ai-unavailable"

    /**
     * One message for all of them, on purpose.
     *
     * A patient does not need to know which internal check declined; they need
     * to know a person is reading it. Explaining the difference would invite
     * them to rephrase until the bot answers, which is the opposite of what
     * these checks are for.
     */
    public var localizedMessage: String { L10n.string("assistant.handover") }
}

public struct AssistantResult: Decodable, Sendable, Equatable {
    /// The stored question — the handle for "this answer is not enough".
    public let questionMessageId: String
    public let answered: Bool
    public let answer: String?
    /// Clinic documents the answer came from.
    public let sources: [String]
    public let handoverReason: HandoverReason?

    /// What to put on screen, whichever way it went.
    public var displayText: String {
        answer ?? (handoverReason?.localizedMessage ?? L10n.string("assistant.handover"))
    }
}

public struct AssistantAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Asks the FAQ assistant. It answers only from the clinic's own documents.
    public func ask(_ question: String) async throws -> AssistantResult {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/assistant/ask",
                body: try JSONEncoder.klinik.encode(AskBody(question: question))
            ),
            as: AssistantResult.self
        )
    }

    /// "This answer is not enough, send it to a doctor."
    public func escalate(_ messageId: String) async throws {
        _ = try await client.send(
            Endpoint(method: .post, path: "me/assistant/\(messageId)/escalate"),
            as: EmptyResponse.self
        )
    }

    private struct AskBody: Encodable {
        let question: String
    }

    private struct EmptyResponse: Decodable {}
}

import Foundation
import KlinikAPI
import KlinikCore

/// One turn of the conversation, as the screen renders it.
public struct AssistantTurn: Sendable, Equatable, Identifiable {
    public let id: String
    public let question: String
    public let result: AssistantResult?
    /// Set when the ask itself failed — a network error, not a handover.
    public let failure: String?
    public var escalated: Bool

    public var isAnswered: Bool { result?.answered == true }

    /// Whether this turn can still be handed to a person. A handover has
    /// already gone to the clinic, so offering it again would send it twice.
    public var canEscalate: Bool {
        guard let result else { return false }

        return result.answered && !escalated
    }
}

public enum AssistantPhase: Sendable, Equatable {
    case idle
    case asking
    case failed(String)
}

public struct AssistantState: Sendable, Equatable {
    public var phase: AssistantPhase = .idle
    public var turns: [AssistantTurn] = []
    public var escalatingId: String?

    public init() {}
}

/**
 * The FAQ assistant (spec M4).
 *
 * The rules that matter here are the server's, not this model's: the assistant
 * answers only from the clinic's own documents, it does not diagnose, and when
 * it is not sure it hands the question to a person. This model's job is to not
 * undo any of that — which mostly means rendering a handover as a handover
 * rather than as a failure, and never showing an answer without the button
 * that takes it to a human.
 *
 * A question that could not be sent at all is different again: nothing reached
 * the clinic, and telling somebody "a person will answer this" when nobody has
 * it would be a lie the screen tells on the model's behalf.
 */
@MainActor
public final class AssistantModel {
    private let api: AssistantAPI
    private var state = AssistantState()

    public init(api: AssistantAPI) {
        self.api = api
    }

    public func currentState() -> AssistantState { state }

    public func ask(_ question: String) async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        state.phase = .asking

        // The question goes on screen before the answer arrives, so somebody
        // can see what they asked while they wait.
        let pendingId = UUID().uuidString
        state.turns.append(
            AssistantTurn(
                id: pendingId,
                question: trimmed,
                result: nil,
                failure: nil,
                escalated: false
            )
        )

        do {
            let result = try await api.ask(trimmed)

            replace(pendingId) {
                AssistantTurn(
                    id: result.questionMessageId,
                    question: trimmed,
                    result: result,
                    failure: nil,
                    // A handover has already reached the clinic; the server did
                    // that, and offering to send it again would send it twice.
                    escalated: !result.answered
                )
            }

            state.phase = .idle
        } catch let error as APIError {
            fail(pendingId, trimmed, L10n.message(for: error))
        } catch {
            fail(pendingId, trimmed, L10n.string("error.server"))
        }
    }

    /// "This answer is not enough, send it to a doctor."
    public func escalate(_ turnId: String) async {
        state.escalatingId = turnId

        defer { state.escalatingId = nil }

        do {
            try await api.escalate(turnId)

            if let index = state.turns.firstIndex(where: { $0.id == turnId }) {
                state.turns[index].escalated = true
            }
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    private func replace(_ id: String, with turn: () -> AssistantTurn) {
        guard let index = state.turns.firstIndex(where: { $0.id == id }) else { return }

        state.turns[index] = turn()
    }

    private func fail(_ id: String, _ question: String, _ message: String) {
        replace(id) {
            AssistantTurn(
                id: id,
                question: question,
                result: nil,
                failure: message,
                escalated: false
            )
        }

        state.phase = .idle
    }
}

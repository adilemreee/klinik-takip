import Foundation
import KlinikAPI
import KlinikCore

/**
 * Sends queued writes through the same client everything else uses.
 *
 * The entry carries the request, so this does not know what a measurement or a
 * dose log is — it replays what the user's tap would have sent, under the same
 * idempotency key, and reads the answer.
 */
public struct APIOutboxSender: OutboxSender {
    /// The 409 the backend uses when a record moved on under an edit.
    static let versionConflict = "VERSION_CONFLICT"

    /**
     * The 409 the backend uses when the same key is already being processed.
     *
     * It means the previous attempt is still running — the phone gave up on a
     * request the server did not — so the queue waits rather than telling the
     * user something needs their attention.
     */
    static let inFlight = "IDEMPOTENCY_IN_FLIGHT"

    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func send(_ entry: OutboxEntry) async -> SendOutcome {
        switch await client.replay(entry.write) {
        case .succeeded:
            return .applied

        case .failed(let error, let body):
            return APIOutboxSender.outcome(for: error, body: body)
        }
    }

    /// Separated from the network so the mapping is testable on its own — it
    /// is the part that decides whether a person has to be told something.
    static func outcome(for error: APIError, body: Data) -> SendOutcome {
        guard case .conflict(let response) = error else {
            return SendOutcome.from(error)
        }

        if response.message == inFlight {
            return .retryable(L10n.string("error.timedOut"))
        }

        if response.message == versionConflict, let conflict = serverSide(of: body) {
            return .conflict(serverRecord: conflict.record, serverVersion: conflict.version)
        }

        // Any other 409 is the server saying no for a reason of its own — a
        // questionnaire already answered, a payment already reversed. Retrying
        // will not change it, and the user is told.
        return .rejected(L10n.message(for: error))
    }

    /// What the server has now, pulled out of the conflict body.
    ///
    /// `JSONSerialization` rather than a Codable type: the record is a
    /// different shape for every endpoint, and this layer's job is to carry it
    /// to the screen that knows, not to understand it.
    private static func serverSide(of body: Data) -> (record: Data, version: Int)? {
        guard
            let parsed = try? JSONSerialization.jsonObject(with: body),
            let object = parsed as? [String: Any],
            let version = object["currentVersion"] as? Int,
            let current = object["current"],
            let record = try? JSONSerialization.data(withJSONObject: current)
        else {
            return nil
        }

        return (record, version)
    }
}

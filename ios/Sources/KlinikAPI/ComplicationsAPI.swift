import Foundation
import KlinikCore

public enum ComplicationStatus: String, Decodable, Sendable, Equatable {
    case reported = "REPORTED"
    case acknowledged = "ACKNOWLEDGED"
    case resolved = "RESOLVED"

    public var localizedName: String { L10n.string("complication.status.\(rawValue)") }
}

public struct Complication: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let status: ComplicationStatus
    /// What the patient said, in their own words.
    public let note: String
    public let bodyArea: String?
    public let reportedAt: Date
    public let acknowledgedAt: Date?
    /// What the clinician answered.
    public let firstResponse: String?
    public let resolvedAt: Date?
    public let resolution: String?
}

/// Who reported it. An id names nobody a clinician would recognise.
public struct ComplicationPatient: Decodable, Sendable, Equatable {
    public let id: String
    public let mrn: String
    public let fullName: String
}

public struct ComplicationView: Decodable, Sendable, Equatable, Identifiable {
    public let complication: Complication
    /**
     * Whose report it is.
     *
     * The queue is clinic-wide, and a row naming only a body area and a
     * sentence is one nobody can act on: "karın, ağrı var" does not say whose
     * abdomen it is.
     */
    public let patient: ComplicationPatient
    public let photos: [ClinicalPhoto]
    /// Minutes from report to first answer, or to now while still waiting.
    public let waitingMinutes: Int
    /// Nil until someone answered.
    public let responseMinutes: Int?
    /// Still unanswered past the clinic threshold.
    public let overdue: Bool

    public var id: String { complication.id }

    /**
     * How long, in words a clinician does not have to divide.
     *
     * The queue was showing the raw count: a six-hour-old report read "372 dk"
     * and a day-old one "1400 dk", on the one screen where how long somebody
     * has been waiting is the whole point. Minutes for the first hour, then
     * hours — the same sentences the agenda uses.
     */
    public var localizedWait: String {
        if let answered = responseMinutes {
            return answered < 60
                ? String(format: L10n.string("common.respondedInMinutes"), answered)
                : String(format: L10n.string("common.respondedInHours"), answered / 60)
        }

        return waitingMinutes < 60
            ? String(format: L10n.string("common.waitingMinutes"), waitingMinutes)
            : String(format: L10n.string("common.waitingHours"), waitingMinutes / 60)
    }
}

public struct ComplicationsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    // MARK: - Patient side

    /**
     * A complaint the patient reports themselves.
     *
     * Queued when there is no connection (spec M15) — and the screen that
     * catches `queuedForLater` says, in the same breath, to telephone the
     * clinic if it is urgent. A queue is the right home for a report that
     * would otherwise be lost, and the wrong home for an emergency; the
     * emergency button deliberately does not use one.
     *
     * **No client timestamp, deliberately.** The dose check-in next door sends
     * one because the minute a tablet was taken *is* the clinical record. A
     * complaint is not that: what matters clinically is when the symptom
     * started, which the patient writes in their own words, and the server's
     * `reportedAt` is the clock the response-time target is measured against.
     * Rewriting it with the phone's time would charge the clinic for hours it
     * spent not knowing, and a second column beside it would be one nothing
     * displays.
     */
    public func report(
        note: String,
        bodyArea: String?,
        photoIds: [String]
    ) async throws -> ComplicationView {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/complications",
                body: try JSONEncoder.klinik.encode(
                    ReportBody(note: note, bodyArea: bodyArea, photoIds: photoIds)
                ),
                offline: .queue(
                    .standalone(
                        entityType: ComplicationsAPI.queuedEntity,
                        summary: L10n.string("sync.item.complication")
                    )
                )
            ),
            as: ComplicationView.self
        )
    }

    /// What a queued report is filed under.
    public static let queuedEntity = "complication"

    public func mine() async throws -> [ComplicationView] {
        try await client.send(
            Endpoint(method: .get, path: "me/complications"),
            as: [ComplicationView].self
        )
    }

    // MARK: - Clinician side

    public func queue(includeResolved: Bool = false) async throws -> [ComplicationView] {
        try await client.send(
            Endpoint(
                method: .get,
                path: "complications",
                query: includeResolved ? ["includeResolved": "true"] : [:]
            ),
            as: [ComplicationView].self
        )
    }

    public func acknowledge(id: String, message: String) async throws -> ComplicationView {
        try await respond(path: "complications/\(id)/acknowledge", message: message)
    }

    public func resolve(id: String, message: String) async throws -> ComplicationView {
        try await respond(path: "complications/\(id)/resolve", message: message)
    }

    private func respond(path: String, message: String) async throws -> ComplicationView {
        try await client.send(
            Endpoint(
                method: .patch,
                path: path,
                body: try JSONEncoder.klinik.encode(RespondBody(message: message))
            ),
            as: ComplicationView.self
        )
    }

    private struct ReportBody: Encodable {
        let note: String
        let bodyArea: String?
        let photoIds: [String]
    }

    private struct RespondBody: Encodable {
        let message: String
    }
}

import Foundation
import KlinikAPI
import KlinikCore

public enum AuditPhase: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case notPermitted
    case failed(String)
}

public struct AuditState: Sendable, Equatable {
    public var phase: AuditPhase = .loading
    public var entries: [AuditEntry] = []
    public var anomalies: [AuditAnomaly] = []
    public var filter = AuditFilter()
    public var nextCursor: String?
    public var loadingMore = false

    public init() {}

    public var hasMore: Bool { nextCursor != nil }
}

/**
 * The audit trail, for the doctor who owns the clinic (spec M13).
 *
 * Two halves. The trail itself, filtered, because "who opened this file" is a
 * question with an answer. And the anomalies the server detects — a nurse
 * opening two hundred files in a night, access outside working hours, repeated
 * failed sign-ins — which is the half nobody would find by scrolling.
 *
 * Anomalies are shown first and their sentences are the server's own. It knows
 * what it counted and over what window; re-wording that here would be a second
 * description of a thing this client cannot see.
 */
@MainActor
public final class AuditModel {
    private let api: AuditAPI
    private var state = AuditState()

    public init(api: AuditAPI) {
        self.api = api
    }

    public func currentState() -> AuditState { state }

    public func load() async {
        async let entries = attempt { try await self.api.entries(self.state.filter) }
        async let anomalies = attempt { try await self.api.anomalies() }

        let loaded = await (entries, anomalies)

        guard let page = loaded.0.value else {
            // A refusal only when the server refused. An audit log that cannot
            // be reached is not an audit log somebody is barred from.
            switch ReadOutcome.of([loaded.0.error].compactMap { $0 }) {
            case .refused: state.phase = .notPermitted
            case .failed(let message): state.phase = .failed(message)
            }

            return
        }

        state.entries = page.items
        state.nextCursor = page.nextCursor
        state.anomalies = loaded.1.value ?? []
        state.phase = page.items.isEmpty && state.anomalies.isEmpty ? .empty : .loaded
    }

    public func loadMore() async {
        guard let cursor = state.nextCursor, !state.loadingMore else { return }

        state.loadingMore = true
        defer { state.loadingMore = false }

        var filter = state.filter
        filter.cursor = cursor

        guard let page = try? await api.entries(filter) else { return }

        state.entries += page.items
        state.nextCursor = page.nextCursor
    }

    /// Changing a filter starts the list again: a cursor from the old filter
    /// would page through a different set of rows.
    public func filter(by action: AuditAction?) async {
        state.filter.action = action
        state.filter.cursor = nil
        state.nextCursor = nil
        state.phase = .loading

        await load()
    }
}


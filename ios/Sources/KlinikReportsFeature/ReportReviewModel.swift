import Foundation
import KlinikAPI
import KlinikCore

public enum ReportReviewPhase: Sendable, Equatable {
    case loading
    case empty
    case loaded
    case failed(String)
}

public struct ReportReviewState: Sendable, Equatable {
    public var phase: ReportReviewPhase = .loading
    public var reports: [ReportView] = []
    public var busyId: String?
    public var actionError: String?
    /// The report a clinician just signed off, so the row can say so before it
    /// leaves the list.
    public var justReviewedId: String?

    public init() {}
}

/**
 * The queue that unblocks everything else (spec M5).
 *
 * The server holds every critical AI output until a clinician signs it off, and
 * until this screen existed there was nowhere to do that — so the queue only
 * ever grew and nothing reached a patient. Reviewing is one action with two
 * outcomes, not two actions: a doctor who has read the report already knows
 * whether the patient should see it, and splitting the decision would leave a
 * pile of reviewed-but-unreleased reports nobody could tell from unread ones.
 */
@MainActor
public final class ReportReviewModel {
    private let api: ReportsAPI
    private var state = ReportReviewState()

    public init(api: ReportsAPI) {
        self.api = api
    }

    public func currentState() -> ReportReviewState { state }

    public func load() async {
        do {
            let reports = try await api.pending()
            state.reports = reports
            state.phase = reports.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /// Signs one off. `release` decides whether the plain-language half goes to
    /// the patient; the clinical half never does either way.
    public func review(_ reportId: String, release: Bool) async {
        state.busyId = reportId
        state.actionError = nil

        defer { state.busyId = nil }

        do {
            _ = try await api.review(reportId, release: release)

            state.reports.removeAll { $0.id == reportId }
            state.justReviewedId = reportId
            state.phase = state.reports.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            state.actionError = L10n.message(for: error)
        } catch {
            state.actionError = L10n.string("error.server")
        }
    }

    /// Highest risk first, then oldest — a critical report generated an hour ago
    /// outranks a low-risk one from yesterday.
    public func ordered() -> [ReportView] {
        state.reports.sorted { left, right in
            let leftRank = ReportReviewModel.rank(left.report.riskLevel)
            let rightRank = ReportReviewModel.rank(right.report.riskLevel)

            if leftRank != rightRank { return leftRank > rightRank }

            return left.report.generatedAt < right.report.generatedAt
        }
    }

    static func rank(_ level: RiskLevel?) -> Int {
        switch level {
        case .critical: return 3
        case .high: return 2
        case .medium: return 1
        case .low, nil: return 0
        }
    }
}

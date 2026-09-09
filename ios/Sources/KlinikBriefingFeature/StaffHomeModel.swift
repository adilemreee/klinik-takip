import Foundation
import KlinikAPI
import KlinikCore

/// Where a tap on the agenda goes. The screen names destinations; the app
/// decides what they mean, so this module knows nothing about navigation.
public enum StaffHomeTarget: Sendable, Equatable {
    case patient(id: String, name: String)
    case emergencyQueue
    case pendingReports
    case flaggedPhotos
}

public enum StaffHomePhase: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

public struct StaffHomeState: Sendable, Equatable {
    public var phase: StaffHomePhase = .loading
    public var briefing: Briefing?
    /// Open calls, newest escalation first. Empty is the normal case.
    public var emergencies: [StaffEmergencyView] = []
    /// Nil when this account may not review reports — a different thing from
    /// zero, and the screen shows nothing rather than an empty promise.
    public var pendingReportCount: Int?
    /// Nil when this account may not see photographs at all — a different
    /// thing from none being flagged.
    public var flaggedPhotoCount: Int?

    public init() {}

    public var hasEmergencies: Bool { !emergencies.isEmpty }

    /// The longest anyone has been waiting on an unanswered call.
    public var worstEmergencyWait: Int? {
        emergencies.map(\.waitingMinutes).max()
    }
}

/**
 * The doctor's morning (spec M2 "hasta özeti", M5 "günlük doktor brifingi").
 *
 * Four reads, and only one of them may fail the screen. The briefing is the
 * page; the emergency queue and the report queue are things a given account may
 * not be allowed to see at all — a coordinator has no `reports.review` — and a
 * 403 on one of those must not blank a nurse's agenda. So the secondary reads
 * are best-effort and their absence is rendered as absence rather than as zero.
 */
@MainActor
public final class StaffHomeModel {
    private let briefing: BriefingAPI
    private let emergency: EmergencyAPI
    private let reports: ReportsAPI
    private let photos: PhotosAPI

    private var state = StaffHomeState()

    public init(
        briefing: BriefingAPI,
        emergency: EmergencyAPI,
        reports: ReportsAPI,
        photos: PhotosAPI
    ) {
        self.briefing = briefing
        self.emergency = emergency
        self.reports = reports
        self.photos = photos
    }

    public func currentState() -> StaffHomeState { state }

    public func load() async {
        // Only the first is awaited for the phase decision; the rest run
        // alongside it and are allowed to come back empty-handed.
        async let briefingResult = briefingOrError()
        async let emergencyResult = optional { try await emergency.queue() }
        async let reportsResult = optional { try await reports.pending() }
        async let photosResult = optional { try await photos.flagged() }

        let (loaded, emergencies, pending, flagged) = await (
            briefingResult, emergencyResult, reportsResult, photosResult
        )

        state.emergencies = (emergencies ?? []).sorted { $0.waitingMinutes > $1.waitingMinutes }
        state.pendingReportCount = pending?.count
        state.flaggedPhotoCount = flagged?.count

        switch loaded {
        case .arrived(let briefing):
            state.briefing = briefing
            state.phase = .loaded
        case .failed(let message):
            state.phase = .failed(message)
        }
    }

    /// Sorted so an unanswered emergency is never below a missed follow-up.
    public func risks() -> [RiskItem] {
        guard let facts = state.briefing?.facts else { return [] }

        return facts.atRisk.sorted { left, right in
            if left.kind.severity != right.kind.severity {
                return left.kind.severity > right.kind.severity
            }

            return left.waitingMinutes > right.waitingMinutes
        }
    }

    private func briefingOrError() async -> BriefingOutcome {
        do {
            return .arrived(try await briefing.mine())
        } catch let error as APIError {
            return .failed(L10n.message(for: error))
        } catch {
            return .failed(L10n.string("error.server"))
        }
    }

    /// Nil on any failure, including a permission the account does not have.
    private func optional<T: Sendable>(_ work: @Sendable () async throws -> T) async -> T? {
        try? await work()
    }
}

/// The briefing read's two outcomes. A local type rather than `Result`, whose
/// failure must be an `Error` — and the failure here is already a sentence for
/// the reader, chosen by `L10n.message(for:)`.
private enum BriefingOutcome: Sendable {
    case arrived(Briefing)
    case failed(String)
}

extension RiskKind {
    /// The order a clinician would triage in. Higher is sooner.
    var severity: Int {
        switch self {
        case .emergencyUnanswered: return 4
        case .complicationOverdue: return 3
        case .messageUrgent: return 2
        case .reportUnreviewed: return 1
        case .followUpMissed: return 0
        }
    }

    public var tone: RiskTone {
        switch self {
        case .emergencyUnanswered: return .critical
        case .complicationOverdue: return .critical
        case .messageUrgent: return .warning
        case .reportUnreviewed: return .info
        case .followUpMissed: return .warning
        }
    }

    public var symbol: String {
        switch self {
        case .emergencyUnanswered: return "phone.badge.waveform.fill"
        case .complicationOverdue: return "bandage.fill"
        case .messageUrgent: return "exclamationmark.bubble.fill"
        case .reportUnreviewed: return "doc.text.magnifyingglass"
        case .followUpMissed: return "calendar.badge.exclamationmark"
        }
    }
}

/// The design system's `Tone`, restated here so this module does not depend on
/// it: the model is testable without SwiftUI.
public enum RiskTone: Sendable, Equatable {
    case info
    case warning
    case critical
}

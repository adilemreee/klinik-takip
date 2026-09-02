import Foundation
import KlinikAPI
import KlinikCore

public enum LabTrendPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Nothing confirmed yet. Not a failure: results exist only after review.
    case empty
    case notFound
    case failed(String)
}

public struct LabTrendState: Sendable, Equatable {
    public var phase: LabTrendPhase = .loading
    public var trends: [AnalyteTrend] = []
    /// Confirmed values that need looking at now, kept separate from the charts.
    public var critical: [LabResult] = []
    public var selected: String?

    public var selectedTrend: AnalyteTrend? {
        trends.first { $0.id == selected } ?? trends.first
    }

    public init() {}
}

/// The lab trend screen: one series per analyte, with its reference band.
public actor LabTrendModel {
    private let api: LabAPI
    private let patientId: String

    private(set) public var state = LabTrendState()

    public init(api: LabAPI, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    public func currentState() -> LabTrendState { state }

    public func load() async {
        state.phase = .loading

        do {
            // Fetched together so the screen cannot show a chart while still
            // unaware of a critical value on the same patient.
            async let trends = api.trends(patientId: patientId)
            async let critical = api.critical(patientId: patientId)

            state.trends = try await trends
            state.critical = try await critical
            state.selected = state.trends.first?.id
            state.phase = state.trends.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func select(_ id: String) {
        state.selected = id
    }
}

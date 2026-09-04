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
    private let subject: RecordSubject

    private(set) public var state = LabTrendState()

    public init(api: LabAPI, subject: RecordSubject) {
        self.api = api
        self.subject = subject
    }

    public func currentState() -> LabTrendState { state }

    public func load() async {
        state.phase = .loading

        do {
            // Fetched together so a clinician's screen cannot show a chart
            // while still unaware of a critical value on the same patient.
            //
            // A patient looking at their own results does not get the critical
            // list. Spec M16 puts a doctor's review between an analyser and a
            // patient on purpose, and "CRITICAL" in red with nobody to explain
            // it is the outcome that review exists to prevent. The confirmed
            // trend is theirs to see; the alarm is the clinic's to act on.
            async let trends = api.trends(subject: subject)

            state.trends = try await trends

            if case .patient(let id) = subject {
                state.critical = try await api.critical(patientId: id)
            } else {
                state.critical = []
            }
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

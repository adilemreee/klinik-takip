import Foundation
import KlinikAPI
import KlinikCore

public enum ChartPhase: Sendable, Equatable {
    case loading
    case loaded(BodyChart)
    /// No weight has ever been recorded. Distinct from an error: there is
    /// nothing wrong, there is simply nothing to draw yet.
    case empty
    /// The record is not there, or is outside this user's scope. The backend
    /// makes those indistinguishable on purpose.
    case notFound
    case failed(String)
}

public struct MeasurementsState: Sendable, Equatable {
    public var phase: ChartPhase = .loading
    /// Set while a reading is being saved, so the form can refuse a second tap.
    public var saving = false
    /// The reason the last save was refused, ready to show beside the field.
    public var saveError: String?

    public init() {}
}

/// The body-measurement screen: the chart, and recording a new reading.
///
/// An actor rather than an observable object so the same model drives the
/// staff screen and the patient's own, and so the ordering rules below are
/// enforced by the type system rather than by convention.
public actor MeasurementsModel {
    private let api: MeasurementsAPI
    private let subject: MeasurementSubject
    private let source: MeasurementSource

    private(set) public var state = MeasurementsState()

    /// - Parameter source: how readings this model records are labelled. Staff
    ///   screens pass `.nurse` or `.device`; the patient's own screen leaves it
    ///   alone, because the server sets `PATIENT` there and refuses the field.
    public init(
        api: MeasurementsAPI,
        subject: MeasurementSubject,
        source: MeasurementSource = .nurse
    ) {
        self.api = api
        self.subject = subject
        self.source = source
    }

    public func currentState() -> MeasurementsState { state }

    public func load() async {
        state.phase = .loading
        await reload()
    }

    /// Records a reading and redraws from the server's answer.
    ///
    /// Redrawing rather than appending locally: BMI depends on the height in
    /// effect at the time, so a new weight can change more of the curve than
    /// the point just added — and a client that guessed would disagree with
    /// the chart the clinician is looking at.
    @discardableResult
    public func record(_ measurement: NewMeasurement) async -> Bool {
        guard !state.saving else { return false }

        state.saving = true
        state.saveError = nil
        defer { state.saving = false }

        do {
            try await api.record(measurement, for: subject, source: source)
        } catch let error as APIError {
            // A refused reading is the plausibility check doing its job, and
            // the server's message names the range. Showing our own would hide
            // which bound was crossed.
            state.saveError = L10n.message(for: error)
            return false
        } catch {
            state.saveError = L10n.string("error.server")
            return false
        }

        await reload()
        return true
    }

    private func reload() async {
        do {
            let chart = try await api.chart(for: subject)
            state.phase = chart.weight.isEmpty && chart.bmi.isEmpty ? .empty : .loaded(chart)
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
}

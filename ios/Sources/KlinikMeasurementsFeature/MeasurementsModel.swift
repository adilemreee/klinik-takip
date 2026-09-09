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

    /**
     * Readings on this phone that have not reached the clinic (spec M15).
     *
     * Listed beside the chart rather than drawn on it. A queued weight has no
     * BMI — that depends on the height in effect at the time, which is the
     * server's to apply — so plotting it would put a point on a curve the
     * clinician is not looking at, in a position nobody has computed.
     */
    public var unsent: [UnsentMeasurement] = []

    public init() {}
}

/// A reading the patient entered while offline.
public struct UnsentMeasurement: Sendable, Equatable, Identifiable {
    public let id: String
    public let type: MeasurementType
    public let value: Double
    public let secondaryValue: Double?
    public let enteredAt: Date

    public init(
        id: String,
        type: MeasurementType,
        value: Double,
        secondaryValue: Double?,
        enteredAt: Date
    ) {
        self.id = id
        self.type = type
        self.value = value
        self.secondaryValue = secondaryValue
        self.enteredAt = enteredAt
    }
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
    /// The offline queue, read-only. Nil in tests that have nothing to say
    /// about it.
    private let queue: PendingWriteReader?

    private(set) public var state = MeasurementsState()

    /// - Parameter source: how readings this model records are labelled. Staff
    ///   screens pass `.nurse` or `.device`; the patient's own screen leaves it
    ///   alone, because the server sets `PATIENT` there and refuses the field.
    public init(
        api: MeasurementsAPI,
        subject: MeasurementSubject,
        source: MeasurementSource = .nurse,
        queue: PendingWriteReader? = nil
    ) {
        self.api = api
        self.subject = subject
        self.source = source
        self.queue = queue
    }

    public func currentState() -> MeasurementsState { state }

    /**
     * One reading's history, for the kinds the body chart does not draw.
     *
     * Weight and BMI share a composed response because they are drawn together
     * against a goal line. Blood pressure, pulse, temperature, SpO₂, glucose
     * and waist are each their own series — a doctor looking at a fever curve
     * is not also looking at a weight — so they are fetched one at a time, when
     * somebody asks for that one.
     */
    public func series(_ type: MeasurementType) async -> [MeasurementPoint] {
        (try? await api.series(for: subject, type: type)) ?? []
    }

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
        } catch APIError.queuedForLater {
            // Kept, not lost. It appears under the chart marked as unsent, and
            // the form reports success — because from the patient's side the
            // reading *is* recorded; it is the clinic that has not seen it.
            await readQueue()
            return true
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

    /// What the queue is still holding for this subject.
    private func readQueue() async {
        guard let queue else { return }

        state.unsent = await queue.unsent(entityType: MeasurementsAPI.queuedEntity)
            // One patient's readings, not everyone's: the same queue serves the
            // staff screens, where each file is a different subject.
            .filter { $0.path == subject.basePath }
            .compactMap { write in
                guard let reading = MeasurementsAPI.queuedReading(in: write) else { return nil }

                return UnsentMeasurement(
                    id: write.id,
                    type: reading.type,
                    value: reading.value,
                    secondaryValue: reading.secondaryValue,
                    enteredAt: reading.measuredAt ?? write.createdAt
                )
            }
    }

    private func reload() async {
        await readQueue()

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

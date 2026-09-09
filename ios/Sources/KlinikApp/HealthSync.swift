#if canImport(HealthKit)
import HealthKit
#endif
import Foundation
import KlinikAPI
import KlinikCore

/// One reading taken off the phone's health store.
public struct HealthReading: Sendable, Equatable {
    public let type: MeasurementType
    public let value: Double
    public let measuredAt: Date
}

public enum HealthSyncOutcome: Sendable, Equatable {
    case unavailable
    case denied
    /// Nothing new since the last time. Not a failure.
    case nothingNew
    case synced(count: Int)
    case failed(String)
}

/**
 * Reading weight, pulse and steps off the phone (spec M20).
 *
 * Read-only, and only what the clinic charts. HealthKit will hand over
 * everything from menstrual cycles to blood alcohol, and asking for permissions
 * a product does not use is how an app gets refused at review and distrusted by
 * the person who reads the prompt.
 *
 * Nothing is synchronised automatically. The spec asks for the patient's
 * explicit consent (M20), and a silent background upload of a person's weight
 * to a clinic is not that — so this runs when somebody presses a button, and
 * every reading it writes is labelled as having come from a device rather than
 * from them.
 *
 * The last synchronised moment is remembered so pressing twice does not file
 * the same morning's weight again. It is a local convenience, not a source of
 * truth: the server would accept the duplicate, and the chart would show two
 * points on one day.
 */
@MainActor
public final class HealthSync {
    /**
     * One reading a day, per kind: the latest.
     *
     * A watch records a pulse every few minutes, and filing all of them would
     * put four hundred points on a chart meant to show a recovery. Pure, and
     * separate from the HealthKit query, so the rule can be tested without a
     * health store — which is not something a test process has.
     */
    nonisolated static func latestPerDay(
        _ readings: [HealthReading],
        calendar: Calendar = .current
    ) -> [HealthReading] {
        var newestByDay: [Date: HealthReading] = [:]

        for reading in readings {
            let day = calendar.startOfDay(for: reading.measuredAt)

            // Keeps the later of the two rather than trusting the query's
            // order: a caller that sorted the other way would otherwise file
            // the morning's weight and drop the evening's.
            if let existing = newestByDay[day], existing.measuredAt >= reading.measuredAt {
                continue
            }

            newestByDay[day] = reading
        }

        return newestByDay.values.sorted { $0.measuredAt < $1.measuredAt }
    }

    private static let watermarkKey = "xyz.klinik.healthSyncedThrough"

    private let measurements: MeasurementsAPI
    private let defaults: UserDefaults

    public init(measurements: MeasurementsAPI, defaults: UserDefaults = .standard) {
        self.measurements = measurements
        self.defaults = defaults
    }

    public var isAvailable: Bool {
        #if canImport(HealthKit)
        return HKHealthStore.isHealthDataAvailable()
        #else
        return false
        #endif
    }

    public var lastSynced: Date? {
        let stored = defaults.double(forKey: HealthSync.watermarkKey)

        return stored > 0 ? Date(timeIntervalSince1970: stored) : nil
    }

    /// Asks, reads, and files whatever is newer than the last run.
    public func sync() async -> HealthSyncOutcome {
        #if canImport(HealthKit)
        guard isAvailable else { return .unavailable }

        let store = HKHealthStore()
        let wanted = HealthSync.readTypes

        do {
            try await store.requestAuthorization(toShare: [], read: wanted)
        } catch {
            return .denied
        }

        // A month at most on a first run: a decade of weights arriving at once
        // would bury the post-operative curve the chart exists to show. The
        // fallback is arithmetic, not a guess: a calendar that cannot subtract a
        // month is not one worth crashing a health sync over.
        let monthAgo = Calendar.current.date(byAdding: .month, value: -1, to: Date())
        let since = lastSynced ?? monthAgo ?? Date().addingTimeInterval(-30 * 24 * 60 * 60)
        let readings = await HealthSync.read(from: store, since: since)

        guard !readings.isEmpty else { return .nothingNew }

        var filed = 0

        for reading in readings {
            do {
                try await measurements.record(
                    NewMeasurement(
                        type: reading.type,
                        value: reading.value,
                        measuredAt: reading.measuredAt,
                        fromDevice: true
                    ),
                    for: .me
                )
                filed += 1
            } catch let error as APIError {
                // Stops at the first refusal rather than hammering: whatever
                // was filed stays filed, and the watermark is not moved past it.
                return filed > 0 ? .synced(count: filed) : .failed(L10n.message(for: error))
            } catch {
                return filed > 0 ? .synced(count: filed) : .failed(L10n.string("error.server"))
            }
        }

        if let newest = readings.map(\.measuredAt).max() {
            defaults.set(newest.timeIntervalSince1970, forKey: HealthSync.watermarkKey)
        }

        return .synced(count: filed)
        #else
        return .unavailable
        #endif
    }
}

#if canImport(HealthKit)
private extension HealthSync {
    /// Exactly what the clinic charts, and nothing else.
    static var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = []

        if let weight = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            types.insert(weight)
        }

        if let pulse = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            types.insert(pulse)
        }

        return types
    }

    static func read(from store: HKHealthStore, since: Date) async -> [HealthReading] {
        var readings: [HealthReading] = []

        if let weight = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            readings += await samples(
                store: store,
                type: weight,
                since: since,
                unit: .gramUnit(with: .kilo),
                as: .weight
            )
        }

        if let pulse = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            readings += await samples(
                store: store,
                type: pulse,
                since: since,
                unit: HKUnit.count().unitDivided(by: .minute()),
                as: .pulse
            )
        }

        return readings.sorted { $0.measuredAt < $1.measuredAt }
    }

    /// Every sample since the watermark, reduced to one a day by
    /// `latestPerDay`.
    static func samples(
        store: HKHealthStore,
        type: HKQuantityType,
        since: Date,
        unit: HKUnit,
        as measurement: MeasurementType
    ) async -> [HealthReading] {
        let predicate = HKQuery.predicateForSamples(withStart: since, end: Date())

        let samples: [HKQuantitySample] = await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            ) { _, results, _ in
                continuation.resume(returning: (results as? [HKQuantitySample]) ?? [])
            }

            store.execute(query)
        }

        return HealthSync.latestPerDay(
            samples.map {
                HealthReading(
                    type: measurement,
                    value: $0.quantity.doubleValue(for: unit),
                    measuredAt: $0.endDate
                )
            }
        )
    }
}
#endif

import Foundation
import KlinikCore

/// The readings the clinic tracks. Mirrors the backend enum; the raw values are
/// the wire format, so they are not localised — the labels are.
public enum MeasurementType: String, Decodable, Encodable, Sendable, CaseIterable {
    case weight = "WEIGHT"
    case height = "HEIGHT"
    case bloodPressure = "BLOOD_PRESSURE"
    case pulse = "PULSE"
    case temperature = "TEMPERATURE"
    case spo2 = "SPO2"
    case glucose = "GLUCOSE"
    case waist = "WAIST"

    /// Blood pressure is the only reading that carries a second number.
    public var hasSecondaryValue: Bool { self == .bloodPressure }

    public var localizedName: String { L10n.string("measurement.type.\(rawValue)") }
}

public enum MeasurementSource: String, Decodable, Encodable, Sendable {
    case patient = "PATIENT"
    case nurse = "NURSE"
    case device = "DEVICE"

    public var localizedName: String { L10n.string("measurement.source.\(rawValue)") }
}

public struct MeasurementPoint: Decodable, Sendable, Equatable, Identifiable {
    public let measuredAt: Date
    public let value: Double
    /// Diastolic, for blood pressure; nil for everything else.
    public let secondaryValue: Double?
    public let unit: String
    public let source: MeasurementSource

    public var id: Date { measuredAt }
}

public enum BmiCategory: String, Decodable, Sendable, Equatable {
    case underweight = "UNDERWEIGHT"
    case normal = "NORMAL"
    case overweight = "OVERWEIGHT"
    case obeseI = "OBESE_I"
    case obeseII = "OBESE_II"
    case obeseIII = "OBESE_III"

    public var localizedName: String { L10n.string("bmi.category.\(rawValue)") }
}

public struct BmiPoint: Decodable, Sendable, Equatable, Identifiable {
    public let measuredAt: Date
    public let bmi: Double
    public let category: BmiCategory
    public let weightKg: Double
    /// The height in effect when that weight was taken, not the latest one.
    public let heightCm: Double

    public var id: Date { measuredAt }
}

/// Everything the body-measurement screen draws, in one response: the backend
/// composes it so the curve and its goal line cannot come from two different
/// reads of the record.
public struct BodyChart: Decodable, Sendable, Equatable {
    public let weight: [MeasurementPoint]
    public let bmi: [BmiPoint]
    /// Nil when no goal has been set — the chart then draws no line, rather
    /// than a line at zero.
    public let targetWeightKg: Double?
    public let targetBmi: Double?

    public static let empty = BodyChart(weight: [], bmi: [], targetWeightKg: nil, targetBmi: nil)

    public init(
        weight: [MeasurementPoint],
        bmi: [BmiPoint],
        targetWeightKg: Double?,
        targetBmi: Double?
    ) {
        self.weight = weight
        self.bmi = bmi
        self.targetWeightKg = targetWeightKg
        self.targetBmi = targetBmi
    }
}

public struct NewMeasurement: Encodable, Sendable, Equatable {
    public let type: MeasurementType
    public let value: Double
    public let secondaryValue: Double?
    public let measuredAt: Date?
    public let note: String?

    /// Set only on the staff path. On `me/measurements` the server refuses the
    /// field outright rather than quietly rewriting it, so it must be absent —
    /// which a nil optional is, since the synthesised encoder omits it.
    var source: MeasurementSource?

    public init(
        type: MeasurementType,
        value: Double,
        secondaryValue: Double? = nil,
        measuredAt: Date? = nil,
        note: String? = nil
    ) {
        self.type = type
        self.value = value
        self.secondaryValue = secondaryValue
        self.measuredAt = measuredAt
        self.note = note
        self.source = nil
    }
}

/// Staff record against a named patient; a patient records against themselves.
/// The two paths are separate on the server because the source is not the
/// caller's to choose — a reading entered by a patient is marked as such, and
/// this enum keeps that distinction visible on the client too.
public enum MeasurementSubject: Sendable, Equatable {
    case patient(id: String)
    case me

    var basePath: String {
        switch self {
        case .patient(let id): return "patients/\(id)/measurements"
        case .me: return "me/measurements"
        }
    }
}

public struct MeasurementsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func chart(for subject: MeasurementSubject) async throws -> BodyChart {
        try await client.send(
            Endpoint(method: .get, path: "\(subject.basePath)/chart"),
            as: BodyChart.self
        )
    }

    public func series(
        for subject: MeasurementSubject,
        type: MeasurementType,
        from: Date? = nil
    ) async throws -> [MeasurementPoint] {
        var query: [String: String] = [:]
        if let from { query["from"] = ISO8601DateFormatter().string(from: from) }

        return try await client.send(
            Endpoint(method: .get, path: "\(subject.basePath)/\(type.rawValue)", query: query),
            as: [MeasurementPoint].self
        )
    }

    public func latest(
        for subject: MeasurementSubject
    ) async throws -> [String: MeasurementPoint] {
        try await client.send(
            Endpoint(method: .get, path: "\(subject.basePath)/latest"),
            as: [String: MeasurementPoint].self
        )
    }

    public func record(
        _ measurement: NewMeasurement,
        for subject: MeasurementSubject,
        source: MeasurementSource = .nurse
    ) async throws {
        var payload = measurement
        if case .patient = subject { payload.source = source }

        try await client.send(
            Endpoint(
                method: .post,
                path: subject.basePath,
                body: try JSONEncoder.klinik.encode(payload)
            )
        )
    }
}

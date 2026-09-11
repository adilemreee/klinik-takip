import Foundation
import KlinikCore

public enum LabFlag: String, Decodable, Sendable, Equatable {
    case low = "LOW"
    case normal = "NORMAL"
    case high = "HIGH"
    case critical = "CRITICAL"

    public var localizedName: String { L10n.string("lab.flag.\(rawValue)") }
}

public struct LabResult: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    /// LOINC, where the printed name could be mapped.
    public let analyteCode: String?
    public let analyteName: String
    /// Decimal on the wire, because a binary float cannot hold 0.1 exactly.
    public let value: String
    public let unit: String
    public let refLow: String?
    public let refHigh: String?
    /// Null when the report carried no reference range — unclassified, not normal.
    public let flag: LabFlag?
    public let measuredAt: Date
    public let ocrConfidence: String?
    public let verifiedAt: Date?

    /**
     * Whether this one is outside its range.
     *
     * A result with no range is **not** normal — it is unclassified, and the
     * table says so rather than showing a tick nobody earned.
     */
    public var isOutOfRange: Bool {
        flag == .low || flag == .high || flag == .critical
    }

    public var referenceText: String? {
        switch (refLow, refHigh) {
        case let (low?, high?): return "\(low) – \(high)"
        case let (nil, high?): return "< \(high)"
        case let (low?, nil): return "> \(low)"
        default: return nil
        }
    }
}

/**
 * One lab report, as it was printed (spec M16).
 *
 * A trend answers "is this getting better"; a panel answers "what did the
 * blood test say" — every analyte at once, each beside its reference range.
 * The document travels with it so the reader can open the original: the table
 * is what OCR read, and the PDF is what the laboratory printed.
 */
public struct LabPanel: Decodable, Sendable, Equatable, Identifiable {
    public let measuredAt: Date
    public let documentId: String?
    public let documentName: String?

    /**
     * Whether there are bytes behind the report.
     *
     * A row can name one that has none. The reader is not offered a button
     * that opens an error — and the screen says the table is all there is,
     * rather than leaving them to wonder where the PDF went.
     *
     * Defaults to false when the server does not say, which is the safe
     * reading: no offer rather than a broken one.
     */
    public let documentAvailable: Bool

    public let results: [LabResult]

    /// Two reports on the same morning are two reports, so the document is
    /// part of what makes this one identifiable.
    public var id: String { "\(measuredAt.timeIntervalSince1970)|\(documentId ?? "")" }

    /// How many fall outside their reference range — the number worth a badge,
    /// and the reason somebody opens a report they were told was fine.
    public var abnormal: Int {
        results.filter(\.isOutOfRange).count
    }

    /// Present when there is a report to open, which is the only reason the
    /// button exists.
    public var canOpenReport: Bool { documentAvailable && documentId != nil }

    public init(
        measuredAt: Date,
        documentId: String? = nil,
        documentName: String? = nil,
        documentAvailable: Bool = false,
        results: [LabResult]
    ) {
        self.measuredAt = measuredAt
        self.documentId = documentId
        self.documentName = documentName
        self.documentAvailable = documentAvailable
        self.results = results
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        measuredAt = try container.decode(Date.self, forKey: .measuredAt)
        documentId = try container.decodeIfPresent(String.self, forKey: .documentId)
        documentName = try container.decodeIfPresent(String.self, forKey: .documentName)
        documentAvailable =
            try container.decodeIfPresent(Bool.self, forKey: .documentAvailable) ?? false
        results = try container.decode([LabResult].self, forKey: .results)
    }

    private enum CodingKeys: String, CodingKey {
        case measuredAt, documentId, documentName, documentAvailable, results
    }
}

public struct LabReviewItem: Decodable, Sendable, Equatable, Identifiable {
    public let result: LabResult
    /// The engine was unsure; this is one to look at first.
    public let needsAttention: Bool
    /// The printed name has no code yet.
    public let awaitingMapping: Bool

    public var id: String { result.id }
}

/// The corrections a reviewer made. Everything is optional: confirming without
/// changing anything is the common case and must not require restating the row.
public struct LabCorrection: Encodable, Sendable, Equatable {
    public var analyteName: String?
    public var analyteCode: String?
    public var value: Double?
    public var unit: String?
    public var refLow: Double?
    public var refHigh: Double?

    public init(
        analyteName: String? = nil,
        analyteCode: String? = nil,
        value: Double? = nil,
        unit: String? = nil,
        refLow: Double? = nil,
        refHigh: Double? = nil
    ) {
        self.analyteName = analyteName
        self.analyteCode = analyteCode
        self.value = value
        self.unit = unit
        self.refLow = refLow
        self.refHigh = refHigh
    }
}

public struct TrendPoint: Decodable, Sendable, Equatable, Identifiable {
    public let measuredAt: Date
    public let value: Double
    public let flag: LabFlag?
    /// The range this particular result was measured against.
    public let refLow: Double?
    public let refHigh: Double?

    public var id: Date { measuredAt }
}

public struct ReferenceBand: Decodable, Sendable, Equatable {
    public let low: Double?
    public let high: Double?
}

public struct AnalyteTrend: Decodable, Sendable, Equatable, Identifiable {
    public let analyteCode: String?
    public let analyteName: String
    /// Series are split by unit: the same analyte in two units is two series.
    public let unit: String
    public let points: [TrendPoint]
    /// Nil when the points were measured against different ranges — drawing one
    /// band across them would put results on the wrong side of a line they were
    /// never compared to.
    public let reference: ReferenceBand?
    public let latestFlag: LabFlag?

    public var id: String { "\(analyteCode ?? analyteName)|\(unit)" }
}

public struct LabAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// What OCR read and nobody has confirmed. Least certain first.
    public func pending(patientId: String) async throws -> [LabReviewItem] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/lab-results/pending"),
            as: [LabReviewItem].self
        )
    }

    /// Confirmed results as per-analyte series, ready to chart.
    public func trends(subject: RecordSubject, since: Date? = nil) async throws -> [AnalyteTrend] {
        var query: [String: String] = [:]
        if let since { query["since"] = ISO8601DateFormatter().string(from: since) }

        return try await client.send(
            Endpoint(method: .get, path: subject.base("lab-results/trends"), query: query),
            as: [AnalyteTrend].self
        )
    }

    /// Confirmed values far enough outside their range to need attention now.
    /// The reports, newest first. Confirmed results only — on both paths.
    public func panels(subject: RecordSubject) async throws -> [LabPanel] {
        try await client.send(
            Endpoint(method: .get, path: subject.base("lab-results/panels")),
            as: [LabPanel].self
        )
    }

    public func critical(patientId: String) async throws -> [LabResult] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/lab-results/critical"),
            as: [LabResult].self
        )
    }

    /// Confirmed results only — what a trend may be drawn from.
    public func verify(resultId: String, correction: LabCorrection) async throws -> LabResult {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "lab-results/\(resultId)/verify",
                body: try JSONEncoder.klinik.encode(correction)
            ),
            as: LabResult.self
        )
    }

    /// For the table headings and page furniture OCR reads as values.
    public func discard(resultId: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "lab-results/\(resultId)"))
    }
}

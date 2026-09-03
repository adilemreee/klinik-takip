import Foundation
import KlinikCore

/**
 * Files that leave the building (spec M12, T6.5).
 *
 * An export is a request, not a download: it is produced on a queue, the app
 * polls or waits for the notification, and the link handed out afterwards is
 * short-lived and signed. The two things a screen must not get wrong are the
 * ones this type makes hard: a file that has expired is not a file that failed,
 * and an export with omissions is not a complete report.
 */

public enum ExportStatus: String, Decodable, Sendable, Equatable, CaseIterable {
    case queued = "QUEUED"
    case processing = "PROCESSING"
    case done = "DONE"
    case failed = "FAILED"

    public var localizedName: String { L10n.string("export.status.\(rawValue)") }

    /// Whether the app should keep asking.
    public var isPending: Bool { self == .queued || self == .processing }
}

public enum ExportKind: String, Decodable, Sendable, Equatable {
    case patientSummary = "PATIENT_SUMMARY"
    case patientList = "PATIENT_LIST"
}

public enum ExportFormat: String, Codable, Sendable, Equatable, CaseIterable {
    case csv = "CSV"
    case xlsx = "XLSX"
}

/**
 * A column a bulk export can contain.
 *
 * `available` says whether this viewer may have it. A picker must show the
 * unavailable ones as unavailable rather than hiding them: a column that is
 * simply missing from the list looks like a column that does not exist, and
 * somebody will go looking for the data somewhere less careful.
 */
public struct ExportColumn: Decodable, Sendable, Equatable, Identifiable {
    public let key: String
    public let header: String
    public let group: String
    public let permission: String
    public let available: Bool

    public var id: String { key }
}

/// Something deliberately left out of a report, and why.
public struct ExportOmission: Decodable, Sendable, Equatable, Identifiable {
    public let section: String
    public let reason: String
    public let count: Int

    public var id: String { "\(section)-\(reason)" }

    /// The sentence the reader needs, in their own words rather than a code.
    public var localizedNote: String {
        let template = L10n.string("export.omission.\(reason)")

        return template.replacingOccurrences(of: "{count}", with: String(count))
    }
}

public struct ExportContents: Decodable, Sendable, Equatable {
    // A patient summary's manifest.
    public let surgeries: Int?
    public let measurementSeries: Int?
    public let labs: Int?
    public let medications: Int?
    public let photos: Int?
    public let aiReports: Int?
    public let omissions: [ExportOmission]?

    // A bulk list's manifest.
    public let format: ExportFormat?
    public let columns: [String]?
    public let rows: Int?
    /// How many the filter matched, which is more than `rows` when truncated.
    public let matched: Int?
    /// True when the file stops short of the filter's matches.
    public let truncated: Bool?

    /// Whether anything was held back. A report with omissions is not complete.
    public var isComplete: Bool { (omissions ?? []).isEmpty && truncated != true }

    /**
     * The warning a screen must show for a truncated list.
     *
     * A spreadsheet that stops short and does not say so is the one nobody
     * catches: it looks exactly like a complete one, and it will be summed.
     */
    public var truncationNotice: String? {
        guard truncated == true, let rows, let matched else { return nil }

        return L10n.string("export.truncated")
            .replacingOccurrences(of: "{rows}", with: String(rows))
            .replacingOccurrences(of: "{matched}", with: String(matched))
    }
}

public struct ExportRequest: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: ExportKind
    public let status: ExportStatus
    public let patientId: String?
    public let size: Int?
    /// What went in, and what was left out. Null until the file is finished.
    public let contents: ExportContents?
    public let error: String?
    /// After this the stored file is deleted; the record of it stays.
    public let expiresAt: Date?
    public let createdAt: Date

    public var isReady: Bool { status == .done && !hasExpired }

    /**
     * Expired is not failed.
     *
     * A file that was produced, delivered and then cleaned up on schedule is a
     * success; showing it as an error would send somebody looking for a fault
     * that is not there.
     */
    public var hasExpired: Bool {
        guard let expiresAt else { return false }

        return status == .done && expiresAt < Date()
    }

    public var statusText: String {
        hasExpired ? L10n.string("export.expired") : status.localizedName
    }
}

public struct ExportDownload: Decodable, Sendable, Equatable {
    public let url: String
    public let expiresAt: Date
    public let filename: String

    public var isStillValid: Bool { expiresAt > Date() }
}

public struct ExportsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Asks for a patient summary. Photographs are off unless asked for.
    public func requestSummary(
        patientId: String,
        includePhotos: Bool = false
    ) async throws -> ExportRequest {
        try await client.send(
            Endpoint(
                method: .post,
                path: "patients/\(patientId)/exports/summary",
                body: try JSONEncoder.klinik.encode(SummaryBody(includePhotos: includePhotos))
            ),
            as: ExportRequest.self
        )
    }

    /// Asks for a filtered patient list. A column you may not have is refused.
    public func requestPatientList(
        format: ExportFormat = .csv,
        columns: [String]? = nil,
        from: Date? = nil,
        to: Date? = nil,
        country: String? = nil,
        procedure: String? = nil
    ) async throws -> ExportRequest {
        try await client.send(
            Endpoint(
                method: .post,
                path: "exports/patients",
                body: try JSONEncoder.klinik.encode(
                    PatientListBody(
                        format: format,
                        columns: columns,
                        from: from,
                        to: to,
                        country: country,
                        procedure: procedure
                    )
                )
            ),
            as: ExportRequest.self
        )
    }

    /// The catalogue, marked with what this viewer may export.
    public func columns() async throws -> [ExportColumn] {
        try await client.send(
            Endpoint(method: .get, path: "exports/columns"),
            as: [ExportColumn].self
        )
    }

    public func mine() async throws -> [ExportRequest] {
        try await client.send(Endpoint(method: .get, path: "exports"), as: [ExportRequest].self)
    }

    public func status(_ id: String) async throws -> ExportRequest {
        try await client.send(Endpoint(method: .get, path: "exports/\(id)"), as: ExportRequest.self)
    }

    /// A short-lived signed link. Requesting one is recorded in the audit log.
    public func download(_ id: String) async throws -> ExportDownload {
        try await client.send(
            Endpoint(method: .post, path: "exports/\(id)/download"),
            as: ExportDownload.self
        )
    }

    private struct SummaryBody: Encodable {
        let includePhotos: Bool
    }

    private struct PatientListBody: Encodable {
        let format: ExportFormat
        let columns: [String]?
        let from: Date?
        let to: Date?
        let country: String?
        let procedure: String?
    }
}

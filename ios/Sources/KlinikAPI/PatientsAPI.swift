import Foundation
import KlinikCore

public struct Patient: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    /// Human-facing file number, e.g. 2026-K7RMPX.
    public let mrn: String
    public let firstName: String
    public let lastName: String
    public let birthDate: Date
    public let sex: String
    public let country: String
    public let city: String?
    public let preferredLanguage: String
    public let status: String
    public let createdAt: Date

    public var fullName: String { "\(firstName) \(lastName)" }
}

public struct PatientPage: Decodable, Sendable {
    public let items: [Patient]
    /// Null on the last page.
    public let nextCursor: String?
}

public struct PatientSearch: Sendable, Equatable {
    public var query: String?
    public var country: String?
    public var status: String?
    public var cursor: String?
    public var limit: Int?

    public init(
        query: String? = nil,
        country: String? = nil,
        status: String? = nil,
        cursor: String? = nil,
        limit: Int? = nil
    ) {
        self.query = query
        self.country = country
        self.status = status
        self.cursor = cursor
        self.limit = limit
    }

    var queryItems: [String: String] {
        var items: [String: String] = [:]

        if let query, !query.isEmpty { items["q"] = query }
        if let country { items["country"] = country }
        if let status { items["status"] = status }
        if let cursor { items["cursor"] = cursor }
        if let limit { items["limit"] = String(limit) }

        return items
    }
}

/**
 * A new patient file (spec M2).
 *
 * The file number is not here: the server allocates it. A client that could
 * choose one could collide with an existing file, and the number is what a
 * clinic writes on paper.
 */
public struct NewPatient: Encodable, Sendable {
    public let firstName: String
    public let lastName: String
    public let birthDate: Date
    /// `FEMALE`, `MALE` or `OTHER` — the server's enum.
    public let sex: String
    /// ISO 3166-1 alpha-2. Drives the language and the discharge advice.
    public let country: String
    public let city: String?
    public let nationality: String?
    public let preferredLanguage: String?
    public let referralSource: String?
    public let assignedDoctorId: String?

    public init(
        firstName: String,
        lastName: String,
        birthDate: Date,
        sex: String,
        country: String,
        city: String? = nil,
        nationality: String? = nil,
        preferredLanguage: String? = nil,
        referralSource: String? = nil,
        assignedDoctorId: String? = nil
    ) {
        self.firstName = firstName
        self.lastName = lastName
        self.birthDate = birthDate
        self.sex = sex
        self.country = country
        self.city = city
        self.nationality = nationality
        self.preferredLanguage = preferredLanguage
        self.referralSource = referralSource
        self.assignedDoctorId = assignedDoctorId
    }
}

public struct PatientsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Opens a file. The server allocates the file number and returns it.
    public func create(_ patient: NewPatient) async throws -> Patient {
        try await client.send(
            Endpoint(
                method: .post,
                path: "patients",
                body: try JSONEncoder.klinik.encode(patient)
            ),
            as: Patient.self
        )
    }

    public func search(_ search: PatientSearch) async throws -> PatientPage {
        try await client.send(
            Endpoint(method: .get, path: "patients", query: search.queryItems),
            as: PatientPage.self
        )
    }

    public func detail(id: String) async throws -> Patient {
        try await client.send(Endpoint(method: .get, path: "patients/\(id)"), as: Patient.self)
    }
}

// MARK: - Patient-facing

public struct NextAppointment: Decodable, Sendable, Equatable {
    public let id: String
    public let scheduledAt: Date
    public let type: String
    public let location: String?
}

/// Everything the patient home screen needs, in one call.
public struct PatientHomeSummary: Decodable, Sendable, Equatable {
    public struct HomePatient: Decodable, Sendable, Equatable {
        public let id: String
        public let mrn: String
        public let firstName: String
        public let lastName: String
        public let preferredLanguage: String
        public let status: String

        public var fullName: String { "\(firstName) \(lastName)" }
    }

    public let patient: HomePatient
    public let nextAppointment: NextAppointment?
    /// Doses scheduled for today that are still waiting.
    public let medicationsDueToday: Int
    public let unreadMessages: Int
    /// Mandatory pre-op documents not yet uploaded (spec M17).
    public let missingDocuments: Int
}

public struct MeAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// So an extension in another file can reach the client without exposing it.
    func send<T: Decodable & Sendable>(_ endpoint: Endpoint, as type: T.Type) async throws -> T {
        try await client.send(endpoint, as: type)
    }

    public func summary() async throws -> PatientHomeSummary {
        try await client.send(
            Endpoint(method: .get, path: "me/summary"),
            as: PatientHomeSummary.self
        )
    }
}

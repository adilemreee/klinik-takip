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

public struct PatientsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
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

import Foundation
import KlinikCore

/// The travel around an operation (spec M19).
public struct TravelPlan: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let arrivalFlight: String?
    public let arrivalAt: Date?
    public let departureFlight: String?
    public let departureAt: Date?
    public let hotelName: String?
    public let hotelAddress: String?
    public let hotelCheckIn: Date?
    public let hotelCheckOut: Date?
    public let greeterName: String?
    public let greeterPhone: String?
    public let transferNote: String?
    public let interpreterName: String?
    public let interpreterLanguage: String?
    public let interpreterPhone: String?
    /// Set by a clinician. Never computed from the surgery date — how long
    /// somebody must wait before flying is a judgement about them, not a sum.
    public let clearedToFlyAt: Date?
    public let notes: String?
    public let version: Int

    public var hasFlights: Bool { arrivalAt != nil || departureAt != nil }
    public var hasHotel: Bool { hotelName != nil }
    public var hasInterpreter: Bool { interpreterName != nil }
    public var isClearedToFly: Bool { clearedToFlyAt != nil }

    /// Whether anything has been filled in at all.
    public var isEmpty: Bool {
        !hasFlights && !hasHotel && !hasInterpreter && greeterName == nil
            && (transferNote?.isEmpty ?? true) && (notes?.isEmpty ?? true)
    }
}

public struct TravelPlanView: Decodable, Sendable, Equatable {
    public let plan: TravelPlan?
    public let clearedToFlyBy: String?
}

/// A change to the trip. Only what somebody filled in is sent.
public struct TravelPlanEdit: Encodable, Sendable, Equatable {
    public var arrivalFlight: String?
    public var arrivalAt: Date?
    public var departureFlight: String?
    public var departureAt: Date?
    public var hotelName: String?
    public var hotelAddress: String?
    public var hotelCheckIn: Date?
    public var hotelCheckOut: Date?
    public var greeterName: String?
    public var greeterPhone: String?
    public var transferNote: String?
    public var interpreterName: String?
    public var interpreterLanguage: String?
    public var interpreterPhone: String?
    public var notes: String?
    public var expectedVersion: Int?

    public init(
        arrivalFlight: String? = nil,
        arrivalAt: Date? = nil,
        departureFlight: String? = nil,
        departureAt: Date? = nil,
        hotelName: String? = nil,
        hotelAddress: String? = nil,
        hotelCheckIn: Date? = nil,
        hotelCheckOut: Date? = nil,
        greeterName: String? = nil,
        greeterPhone: String? = nil,
        transferNote: String? = nil,
        interpreterName: String? = nil,
        interpreterLanguage: String? = nil,
        interpreterPhone: String? = nil,
        notes: String? = nil,
        expectedVersion: Int? = nil
    ) {
        self.arrivalFlight = arrivalFlight
        self.arrivalAt = arrivalAt
        self.departureFlight = departureFlight
        self.departureAt = departureAt
        self.hotelName = hotelName
        self.hotelAddress = hotelAddress
        self.hotelCheckIn = hotelCheckIn
        self.hotelCheckOut = hotelCheckOut
        self.greeterName = greeterName
        self.greeterPhone = greeterPhone
        self.transferNote = transferNote
        self.interpreterName = interpreterName
        self.interpreterLanguage = interpreterLanguage
        self.interpreterPhone = interpreterPhone
        self.notes = notes
        self.expectedVersion = expectedVersion
    }
}

public struct TravelAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func forPatient(_ patientId: String) async throws -> TravelPlanView {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/travel"),
            as: TravelPlanView.self
        )
    }

    public func mine() async throws -> TravelPlanView {
        try await client.send(Endpoint(method: .get, path: "me/travel"), as: TravelPlanView.self)
    }

    public func save(patientId: String, _ edit: TravelPlanEdit) async throws -> TravelPlan {
        try await client.send(
            Endpoint(
                method: .put,
                path: "patients/\(patientId)/travel",
                body: try JSONEncoder.klinik.encode(edit)
            ),
            as: TravelPlan.self
        )
    }

    /// Needs `medical.decide`: a coordinator may move a hotel booking and may
    /// not decide somebody is fit to fly.
    public func setClearedToFly(patientId: String, cleared: Bool) async throws -> TravelPlan {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "patients/\(patientId)/travel/cleared-to-fly",
                body: try JSONEncoder.klinik.encode(ClearBody(cleared: cleared))
            ),
            as: TravelPlan.self
        )
    }

    private struct ClearBody: Encodable {
        let cleared: Bool
    }
}

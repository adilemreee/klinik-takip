import Foundation
import KlinikCore

/**
 * Who is signed in (spec section 2).
 *
 * The app's first question after a token exists, and the reason it is a server
 * call rather than a decode of the access token: the role decides what a person
 * is shown, and reading it out of a JWT in the client puts that decision
 * somewhere with no way to verify it and no way to revoke it.
 */

public enum UserRole: String, Decodable, Sendable, Equatable, CaseIterable {
    case superAdmin = "SUPER_ADMIN"
    case doctor = "DOCTOR"
    case nurse = "NURSE"
    case coordinator = "COORDINATOR"
    case finance = "FINANCE"
    case patient = "PATIENT"
    case caregiver = "CAREGIVER"

    public var localizedName: String { L10n.string("role.\(rawValue)") }
}

public struct Identity: Decodable, Sendable, Equatable {
    public let userId: String
    public let role: UserRole
    /// For the greeting. Never blank — a nameless greeting looks broken.
    public let displayName: String
    /// The patient file this account *is*. Null for staff, and null for a
    /// patient whose file has not been linked yet.
    public let patientId: String?
    public let isStaff: Bool

    public init(
        userId: String,
        role: UserRole,
        displayName: String,
        patientId: String?,
        isStaff: Bool
    ) {
        self.userId = userId
        self.role = role
        self.displayName = displayName
        self.patientId = patientId
        self.isStaff = isStaff
    }
}

public extension MeAPI {
    /// Who is signed in. The app's first call once a token exists.
    func identity() async throws -> Identity {
        try await send(Endpoint(method: .get, path: "me/identity"), as: Identity.self)
    }
}

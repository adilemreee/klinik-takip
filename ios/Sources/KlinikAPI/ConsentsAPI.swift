import Foundation
import KlinikCore

/**
 * What a patient has agreed to (KVKK, spec §8).
 *
 * `dataProcessing` is in the enum because the server can return one from an
 * older record, and never offered here: processing for treatment rests on KVKK
 * art. 6/3, and the Board's decision 2026/347 forbids putting a consent text in
 * front of somebody where a non-consent ground applies. The server refuses to
 * record one; [ConsentType.askable] is what keeps a screen from offering it.
 */
public enum ConsentType: String, Decodable, Encodable, Sendable, CaseIterable {
    /// The medical procedure consent. Not a KVKK consent — a different
    /// instrument under patient-rights legislation, signed on paper.
    case treatment = "TREATMENT"
    case dataProcessing = "DATA_PROCESSING"
    case photoUsage = "PHOTO_USAGE"
    case marketing = "MARKETING"

    public var localizedName: String { L10n.string("consent.type.\(rawValue)") }
    public var explanation: String { L10n.string("consent.explain.\(rawValue)") }

    /**
     * The consents a patient may give or withdraw in the app.
     *
     * Treatment is signed at the clinic, and data processing must never be
     * asked for at all — asking would suggest a refusal is possible when
     * refusing costs the person their treatment, which makes the consent void.
     */
    public static var askable: [ConsentType] { [.photoUsage, .marketing] }
}

public struct Consent: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let type: ConsentType
    /// Which wording was agreed to. Without it, "they consented" names nothing.
    public let version: Int
    public let signedAt: Date
    public let revokedAt: Date?
    public let active: Bool
}

private struct RecordConsentBody: Encodable {
    let type: String
    let version: Int
    let documentText: String?
}

public struct ConsentsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Everything the caller has ever given, withdrawn ones included.
    public func mine() async throws -> [Consent] {
        try await client.send(Endpoint(method: .get, path: "me/consents"), as: [Consent].self)
    }

    public func give(
        type: ConsentType,
        version: Int,
        documentText: String? = nil
    ) async throws -> Consent {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/consents",
                body: try JSONEncoder.klinik.encode(
                    RecordConsentBody(type: type.rawValue, version: version, documentText: documentText)
                )
            ),
            as: Consent.self
        )
    }

    /// Forward-only: the record is kept, stamped with when it was withdrawn.
    public func withdraw(_ consentId: String) async throws -> Consent {
        try await client.send(
            Endpoint(method: .delete, path: "me/consents/\(consentId)"),
            as: Consent.self
        )
    }

    public func forPatient(_ patientId: String) async throws -> [Consent] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/consents"),
            as: [Consent].self
        )
    }
}

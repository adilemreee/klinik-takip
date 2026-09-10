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

    /**
     * The consents captured with a drawn signature (spec M17).
     *
     * Treatment only, and not in `askable`, because it is not a toggle: it is
     * a document somebody reads and signs. Photo and marketing permissions are
     * KVKK consents given and withdrawn with a tap — putting a signature
     * ritual in front of those would make withdrawing look heavier than
     * giving, which is exactly what the law does not allow.
     */
    public static var signable: [ConsentType] { [.treatment] }
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
    /// Whether a drawn signature was recorded with it (spec M17).
    public let hasSignature: Bool

    public init(
        id: String,
        patientId: String,
        type: ConsentType,
        version: Int,
        signedAt: Date,
        revokedAt: Date?,
        active: Bool,
        hasSignature: Bool = false
    ) {
        self.id = id
        self.patientId = patientId
        self.type = type
        self.version = version
        self.signedAt = signedAt
        self.revokedAt = revokedAt
        self.active = active
        self.hasSignature = hasSignature
    }

    private enum CodingKeys: String, CodingKey {
        case id, patientId, type, version, signedAt, revokedAt, active, hasSignature
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        patientId = try container.decode(String.self, forKey: .patientId)
        type = try container.decode(ConsentType.self, forKey: .type)
        version = try container.decode(Int.self, forKey: .version)
        signedAt = try container.decode(Date.self, forKey: .signedAt)
        revokedAt = try container.decodeIfPresent(Date.self, forKey: .revokedAt)
        active = try container.decode(Bool.self, forKey: .active)
        // Defaulted rather than required: a record written before signatures
        // existed carries no such field, and refusing to decode it would empty
        // the consent list of everything the clinic already has.
        hasSignature = try container.decodeIfPresent(Bool.self, forKey: .hasSignature) ?? false
    }
}

private struct RecordConsentBody: Encodable {
    let type: String
    let version: Int
    let documentText: String?
    /// The drawn signature as base64 PNG, no `data:` prefix.
    let signature: String?
}

private struct SignatureLink: Decodable, Sendable {
    let url: String
    let expiresAt: Date
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

    /**
     * Records a consent, with the signature drawn for it (spec M17).
     *
     * One request, because a consent row without its signature — or a
     * signature with no consent — is a worse record than either alone. The
     * server stores the image and the row together or does neither.
     */
    public func give(
        type: ConsentType,
        version: Int,
        documentText: String? = nil,
        signature: Data? = nil
    ) async throws -> Consent {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/consents",
                body: try JSONEncoder.klinik.encode(
                    RecordConsentBody(
                        type: type.rawValue,
                        version: version,
                        documentText: documentText,
                        signature: signature?.base64EncodedString()
                    )
                )
            ),
            as: Consent.self
        )
    }

    /// A short-lived link to the signature drawn for a consent.
    public func signatureURL(consentId: String) async throws -> URL? {
        let link = try await client.send(
            Endpoint(method: .get, path: "me/consents/\(consentId)/signature"),
            as: SignatureLink.self
        )

        return URL(string: link.url)
    }

    /// The staff side of the same link.
    public func signatureURL(patientId: String, consentId: String) async throws -> URL? {
        let link = try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/consents/\(consentId)/signature"),
            as: SignatureLink.self
        )

        return URL(string: link.url)
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

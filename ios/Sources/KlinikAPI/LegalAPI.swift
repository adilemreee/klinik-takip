import Foundation
import KlinikCore

/// A legal text the clinic publishes, with the version a consent can name.
public struct LegalDocument: Decodable, Sendable, Equatable {
    public let id: String
    /// Which wording this is. "They agreed" means nothing without it.
    public let version: Int
    /// Markdown.
    public let body: String

    public init(id: String, version: Int, body: String) {
        self.id = id
        self.version = version
        self.body = body
    }
}

/**
 * The texts the clinic serves rather than the app compiling in (KVKK m.10).
 *
 * A notice that needs an App Store release to correct stays wrong for a
 * fortnight, and the whole point of an aydınlatma metni is that it is accurate
 * at the moment somebody reads it.
 */
public struct LegalAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /**
     * The treatment consent form (spec M17).
     *
     * Throws `notFound` until the clinic publishes one — and the screen then
     * offers no signing at all. A placeholder somebody can put their signature
     * to would produce a record saying a patient consented to a document that
     * says nothing.
     */
    public func treatmentConsent() async throws -> LegalDocument {
        try await client.send(
            Endpoint(method: .get, path: "legal/treatment-consent"),
            as: LegalDocument.self
        )
    }
}

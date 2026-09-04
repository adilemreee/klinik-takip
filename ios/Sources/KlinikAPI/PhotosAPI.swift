import Foundation
import KlinikCore

public enum PhotoCategory: String, Decodable, Encodable, Sendable, CaseIterable {
    case before = "BEFORE"
    case after = "AFTER"
    case complication = "COMPLICATION"
    case wound = "WOUND"

    public var localizedName: String { L10n.string("photo.category.\(rawValue)") }
}

public struct ClinicalPhoto: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let category: PhotoCategory
    public let bodyArea: String?
    /// Free text: milestones differ per procedure (pre-op, post-op D1, W2, M1…).
    public let phaseLabel: String?
    public let mime: String
    public let size: Int
    public let takenAt: Date
    /// Location metadata was removed before the image was stored.
    public let exifStripped: Bool
    public let isFaceBlurred: Bool
    /// Without a photo-usage consent the image is clinical-use only.
    public let consentId: String?
    public let note: String?

    /**
     * AI pre-assessment (spec M5). Null means nobody has looked.
     *
     * A **flag**, never a diagnosis, and never shown to a patient — the photo
     * endpoints require `photos.read`, which no patient holds.
     */
    public let aiReviewSuggested: Bool?
    /// What was observed, from a closed vocabulary. Never a condition name.
    public let aiFindings: [String]
    public let aiAssessedAt: Date?

    public var hasUsageConsent: Bool { consentId != nil }

    /// Somebody looked and found nothing, as opposed to nobody having looked.
    public var isAssessedClean: Bool { aiReviewSuggested == false }
    public var needsReview: Bool { aiReviewSuggested == true }

    public var localizedFindings: [String] {
        aiFindings.map { L10n.string("photo.finding.\($0)") }
    }
}

public struct GalleryGroup: Decodable, Sendable, Equatable, Identifiable {
    public let bodyArea: String?
    /// Oldest first: a progression reads forwards.
    public let photos: [ClinicalPhoto]

    public var id: String { bodyArea ?? "" }
}

/// Why nothing was assessed, when nothing was.
public enum AssessmentSkip: String, Decodable, Sendable, Equatable {
    /// The clinic has not switched photo assessment on.
    case disabled
    case unsupportedImage = "unsupported-image"
    case aiUnavailable = "ai-unavailable"
    /// The answer could not be read, so the photo is left exactly as it was.
    case unreadable
}

public struct PhotoAssessment: Decodable, Sendable, Equatable {
    public let photo: ClinicalPhoto
    /// From a closed vocabulary. A word outside it is dropped, not passed through.
    public let findings: [String]
    /// Any finding at all means a clinician should look.
    public let reviewSuggested: Bool
    public let model: String?
    public let skippedReason: AssessmentSkip?

    public var wasAssessed: Bool { skippedReason == nil }
}

public struct PhotoLink: Decodable, Sendable, Equatable {
    public let url: String
    public let expiresAt: Date
}

public struct PhotosAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /**
     * Photos the pre-assessment flagged, oldest first.
     *
     * A worklist: ordered newest-first it would be one where the oldest thing
     * waits forever.
     */
    public func flagged() async throws -> [ClinicalPhoto] {
        try await client.send(
            Endpoint(method: .get, path: "photos/flagged"),
            as: [ClinicalPhoto].self
        )
    }

    /// Asks for a pre-assessment. Sends a clinical photograph to a third party.
    public func assess(_ photoId: String) async throws -> PhotoAssessment {
        try await client.send(
            Endpoint(method: .post, path: "photos/\(photoId)/assess"),
            as: PhotoAssessment.self
        )
    }

    public func gallery(
        subject: RecordSubject,
        category: PhotoCategory? = nil,
        bodyArea: String? = nil
    ) async throws -> [GalleryGroup] {
        var query: [String: String] = [:]
        if let category { query["category"] = category.rawValue }
        if let bodyArea { query["bodyArea"] = bodyArea }

        return try await client.send(
            Endpoint(method: .get, path: subject.base("photos"), query: query),
            as: [GalleryGroup].self
        )
    }

    /// The photo a new capture should be lined up against, or nil for the first
    /// of its body area.
    public func overlayReference(
        subject: RecordSubject,
        bodyArea: String
    ) async throws -> ClinicalPhoto? {
        let photo = try await client.send(
            Endpoint(
                method: .get,
                path: subject.base("photos/overlay"),
                query: ["bodyArea": bodyArea]
            ),
            as: OptionalPhoto.self
        )

        return photo.value
    }

    /// A fresh link each time: they are short-lived and are never stored.
    public func link(photoId: String) async throws -> PhotoLink {
        try await client.send(
            Endpoint(method: .get, path: "photos/\(photoId)/url"),
            as: PhotoLink.self
        )
    }

    public func upload(
        subject: RecordSubject,
        fileURL: URL,
        category: PhotoCategory,
        bodyArea: String?,
        phaseLabel: String?,
        takenAt: Date? = nil,
        note: String? = nil,
        consentId: String? = nil
    ) async throws -> ClinicalPhoto {
        var fields = ["category": category.rawValue]
        if let bodyArea { fields["bodyArea"] = bodyArea }
        if let phaseLabel { fields["phaseLabel"] = phaseLabel }
        if let takenAt { fields["takenAt"] = ISO8601DateFormatter().string(from: takenAt) }
        if let note { fields["note"] = note }
        if let consentId { fields["consentId"] = consentId }

        return try await client.upload(
            Endpoint(method: .post, path: subject.base("photos")),
            multipart: MultipartBody(
                fields: fields,
                fileURL: fileURL,
                contentType: "image/jpeg"
            ),
            as: ClinicalPhoto.self
        )
    }

    public func remove(photoId: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "photos/\(photoId)"))
    }
}

/// The overlay endpoint answers with an empty object when there is nothing to
/// line up against, which is not the same as a missing field.
private struct OptionalPhoto: Decodable, Sendable {
    let value: ClinicalPhoto?

    init(from decoder: Decoder) throws {
        value = try? ClinicalPhoto(from: decoder)
    }
}

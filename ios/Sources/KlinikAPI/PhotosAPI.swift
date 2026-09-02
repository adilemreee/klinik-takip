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

    public var hasUsageConsent: Bool { consentId != nil }
}

public struct GalleryGroup: Decodable, Sendable, Equatable, Identifiable {
    public let bodyArea: String?
    /// Oldest first: a progression reads forwards.
    public let photos: [ClinicalPhoto]

    public var id: String { bodyArea ?? "" }
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

    public func gallery(
        patientId: String,
        category: PhotoCategory? = nil,
        bodyArea: String? = nil
    ) async throws -> [GalleryGroup] {
        var query: [String: String] = [:]
        if let category { query["category"] = category.rawValue }
        if let bodyArea { query["bodyArea"] = bodyArea }

        return try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/photos", query: query),
            as: [GalleryGroup].self
        )
    }

    /// The photo a new capture should be lined up against, or nil for the first
    /// of its body area.
    public func overlayReference(
        patientId: String,
        bodyArea: String
    ) async throws -> ClinicalPhoto? {
        let photo = try await client.send(
            Endpoint(
                method: .get,
                path: "patients/\(patientId)/photos/overlay",
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
        patientId: String,
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
            Endpoint(method: .post, path: "patients/\(patientId)/photos"),
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

import Foundation
import KlinikAPI
import KlinikCore

public enum GalleryPhase: Sendable, Equatable {
    case loading
    case loaded
    /// No photos yet. Not a failure.
    case empty
    case notFound
    case failed(String)
}

/// The two photos a comparison shows, and which way round they go.
public struct ComparisonPair: Sendable, Equatable {
    public let before: ClinicalPhoto
    public let after: ClinicalPhoto
}

public struct GalleryState: Sendable, Equatable {
    public var phase: GalleryPhase = .loading
    public var groups: [GalleryGroup] = []
    public var selectedArea: String?
    public var uploading = false
    public var error: String?

    public var selectedGroup: GalleryGroup? {
        groups.first { $0.id == selectedArea } ?? groups.first
    }

    /**
     * The pair a comparison opens on: the earliest and the latest of the
     * selected body area.
     *
     * Nil for a single photo, because a comparison of one image against itself
     * is a slider that does nothing, and showing it suggests there is a change
     * to see.
     */
    public var comparison: ComparisonPair? {
        guard let photos = selectedGroup?.photos, photos.count >= 2,
              let first = photos.first, let last = photos.last
        else { return nil }

        return ComparisonPair(before: first, after: last)
    }

    public init() {}
}

/// The before/after gallery (spec M7).
public actor PhotoGalleryModel {
    private let api: PhotosAPI
    private let patientId: String

    private(set) public var state = GalleryState()

    public init(api: PhotosAPI, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    public func currentState() -> GalleryState { state }

    public func load(category: PhotoCategory? = nil) async {
        state.phase = .loading

        do {
            let groups = try await api.gallery(patientId: patientId, category: category)
            state.groups = groups
            state.selectedArea = groups.first?.id
            state.phase = groups.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func select(area: String) {
        state.selectedArea = area
    }

    /// The photo a new capture lines up against, for the translucent guide.
    public func overlayReference(bodyArea: String) async -> ClinicalPhoto? {
        try? await api.overlayReference(patientId: patientId, bodyArea: bodyArea)
    }

    @discardableResult
    public func upload(
        fileURL: URL,
        category: PhotoCategory,
        bodyArea: String?,
        phaseLabel: String?
    ) async -> Bool {
        guard !state.uploading else { return false }

        state.uploading = true
        state.error = nil
        defer { state.uploading = false }

        do {
            _ = try await api.upload(
                patientId: patientId,
                fileURL: fileURL,
                category: category,
                bodyArea: bodyArea,
                phaseLabel: phaseLabel
            )
        } catch let error as APIError {
            // The server refuses a format whose location data it cannot strip,
            // and says so. Replacing that with our own message would leave the
            // person guessing why a perfectly good photo was rejected.
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        // Reloaded rather than appended: the server decides the stored type and
        // the phase grouping, and a guessed row would disagree with the one
        // beside it after the next refresh.
        await load()
        return true
    }

    public func remove(photoId: String) async {
        do {
            try await api.remove(photoId: photoId)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return
        } catch {
            state.error = L10n.string("error.server")
            return
        }

        await load()
    }
}

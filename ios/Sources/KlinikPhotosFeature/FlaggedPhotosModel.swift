import Foundation
import KlinikAPI
import KlinikCore

public enum FlaggedPhase: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case notPermitted
    case failed(String)
}

public struct FlaggedState: Sendable, Equatable {
    public var phase: FlaggedPhase = .loading
    public var photos: [FlaggedPhoto] = []
    public var busyId: String?
    public var error: String?

    public init() {}
}

/**
 * Photographs the pre-read marked for a clinician (spec M5, M7).
 *
 * A worklist, oldest first: a queue sorted newest-first is a queue whose oldest
 * item waits forever, and the oldest item here is somebody who photographed a
 * wound three days ago because it worried them.
 *
 * The pre-read is a flag, never a diagnosis. Nothing on this screen says what
 * is wrong — it says a machine noticed something and a person should look,
 * which is the only claim the model is allowed to make.
 */
@MainActor
public final class FlaggedPhotosModel {
    private let api: PhotosAPI
    private var state = FlaggedState()

    public init(api: PhotosAPI) {
        self.api = api
    }

    public func currentState() -> FlaggedState { state }

    public func load() async {
        do {
            state.photos = try await api.flagged()
            state.phase = state.photos.isEmpty ? .empty : .loaded
        } catch APIError.forbidden {
            state.phase = .notPermitted
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /// Asks for a pre-assessment of one photograph.
    ///
    /// Sends a clinical photograph to a third party, which is why it is a press
    /// and not something the gallery does on scroll.
    public func assess(_ photoId: String) async -> AssessmentSkip? {
        state.busyId = photoId
        state.error = nil

        defer { state.busyId = nil }

        do {
            let assessment = try await api.assess(photoId)

            if let index = state.photos.firstIndex(where: { $0.id == photoId }) {
                state.photos[index] = state.photos[index].reassessed(as: assessment.photo)
            }

            return assessment.skippedReason
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return nil
    }

    /// Oldest first — the point of a worklist.
    public func ordered() -> [FlaggedPhoto] {
        state.photos.sorted { $0.takenAt < $1.takenAt }
    }
}

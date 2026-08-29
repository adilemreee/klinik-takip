import Foundation
import KlinikAPI
import KlinikCore

public enum LabReviewPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Nothing waiting. The good state, and not the same as a failure.
    case empty
    case notFound
    case failed(String)
}

public struct LabReviewState: Sendable, Equatable {
    public var phase: LabReviewPhase = .loading
    public var items: [LabReviewItem] = []
    /// The row currently being confirmed, so its buttons can be disabled.
    public var working: String?
    public var error: String?

    /// How many the engine was unsure about — the reason to open this screen.
    public var needingAttention: Int { items.filter(\.needsAttention).count }

    public init() {}
}

/// The doctor's review queue for what OCR read.
///
/// Nothing on this screen is in the patient's record yet. That is the whole
/// point of it: OCR output is never approved automatically (spec M16), and the
/// only way a value becomes clinical is a person confirming it here.
public actor LabReviewModel {
    private let api: LabAPI
    private let patientId: String

    private(set) public var state = LabReviewState()

    public init(api: LabAPI, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    public func currentState() -> LabReviewState { state }

    public func load() async {
        state.phase = .loading

        do {
            let items = try await api.pending(patientId: patientId)
            state.items = items
            state.phase = items.isEmpty ? .empty : .loaded
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

    /// Confirms one row, with whatever the reviewer corrected.
    @discardableResult
    public func confirm(_ resultId: String, correction: LabCorrection = LabCorrection()) async -> Bool {
        guard state.working == nil else { return false }

        state.working = resultId
        state.error = nil
        defer { state.working = nil }

        do {
            _ = try await api.verify(resultId: resultId, correction: correction)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        remove(resultId)
        return true
    }

    /// Drops something OCR read that is not a result at all.
    @discardableResult
    public func discard(_ resultId: String) async -> Bool {
        guard state.working == nil else { return false }

        state.working = resultId
        state.error = nil
        defer { state.working = nil }

        do {
            try await api.discard(resultId: resultId)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        remove(resultId)
        return true
    }

    /// Removed locally rather than by reloading: the reviewer is working down a
    /// list, and re-fetching would move rows under their finger.
    private func remove(_ resultId: String) {
        state.items.removeAll { $0.id == resultId }
        if state.items.isEmpty { state.phase = .empty }
    }
}

import Foundation
import KlinikAPI
import KlinikCore

public enum ComplicationsPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Nothing waiting, or nothing reported. The good state.
    case empty
    case notFound
    case failed(String)
}

public struct ComplicationsState: Sendable, Equatable {
    public var phase: ComplicationsPhase = .loading
    public var items: [ComplicationView] = []
    /// The report currently being acted on, so its buttons can be disabled.
    public var working: String?
    public var submitting = false
    public var error: String?

    /// How many have been waiting past the clinic threshold — the number that
    /// makes someone open this screen.
    public var overdueCount: Int { items.filter(\.overdue).count }

    public init() {}
}

/// The clinician's queue of reports still waiting (spec M7).
public actor ComplicationQueueModel {
    private let api: ComplicationsAPI

    private(set) public var state = ComplicationsState()

    public init(api: ComplicationsAPI) {
        self.api = api
    }

    public func currentState() -> ComplicationsState { state }

    public func load(includeResolved: Bool = false) async {
        state.phase = .loading

        do {
            let items = try await api.queue(includeResolved: includeResolved)
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

    @discardableResult
    public func acknowledge(_ id: String, message: String) async -> Bool {
        await act(id) { try await self.api.acknowledge(id: id, message: message) }
    }

    @discardableResult
    public func resolve(_ id: String, message: String) async -> Bool {
        await act(id) { try await self.api.resolve(id: id, message: message) }
    }

    /**
     * Replaces the row in place with what the server returned.
     *
     * Not removed: a report that has just been answered is still the clinician's
     * to close, and taking it off the screen the moment they replied would make
     * them go looking for it again.
     */
    private func act(
        _ id: String,
        _ work: @Sendable () async throws -> ComplicationView
    ) async -> Bool {
        guard state.working == nil else { return false }

        state.working = id
        state.error = nil
        defer { state.working = nil }

        do {
            let updated = try await work()
            state.items = state.items.map { $0.id == id ? updated : $0 }
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        return true
    }
}

/// The patient's side: reporting, and seeing what the clinic said back.
public actor MyComplicationsModel {
    private let api: ComplicationsAPI

    private(set) public var state = ComplicationsState()

    public init(api: ComplicationsAPI) {
        self.api = api
    }

    public func currentState() -> ComplicationsState { state }

    public func load() async {
        state.phase = .loading

        do {
            let items = try await api.mine()
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

    @discardableResult
    public func report(
        note: String,
        bodyArea: String?,
        photoIds: [String] = []
    ) async -> Bool {
        guard !state.submitting else { return false }

        state.submitting = true
        state.error = nil
        defer { state.submitting = false }

        do {
            _ = try await api.report(note: note, bodyArea: bodyArea, photoIds: photoIds)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        await load()
        return true
    }
}

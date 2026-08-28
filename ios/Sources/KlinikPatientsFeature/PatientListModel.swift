import Foundation
import KlinikAPI
import KlinikCore

/// What the list is showing right now.
///
/// Empty and failed are separate cases because the screen must say different
/// things: "no patients match" invites changing the search, "you are offline"
/// invites waiting (spec section 7 asks for both to be designed).
public enum ListPhase: Sendable, Equatable {
    case idle
    case loadingFirstPage
    case loaded
    case empty
    case failed(String)
}

public struct PatientListState: Sendable, Equatable {
    public var phase: ListPhase = .idle
    public var patients: [Patient] = []
    /// True while a further page is on its way, so the footer can show it
    /// without the whole list flashing a spinner.
    public var isLoadingMore = false
    public var hasMore = false
    public var query = ""

    public init() {}
}

/// Drives the staff-side patient list: search, paging and the states between.
public actor PatientListModel {
    private let api: PatientsAPI
    private let pageSize: Int

    private var cursor: String?

    /// Increments on every new search. A response whose generation is stale is
    /// dropped rather than applied.
    private var generation = 0

    private(set) public var state = PatientListState()

    public init(api: PatientsAPI, pageSize: Int = 25) {
        self.api = api
        self.pageSize = pageSize
    }

    public func currentState() -> PatientListState { state }

    /// Starts again from the first page. Called on appear and on every change
    /// to the search text.
    public func search(query: String) async {
        generation += 1
        let thisGeneration = generation

        cursor = nil
        state.query = query
        state.phase = .loadingFirstPage
        state.isLoadingMore = false

        do {
            let page = try await api.search(PatientSearch(query: query, limit: pageSize))

            // A slower response for an earlier query must not overwrite a newer
            // one. Typing "Zim" then "Zimm" sends two requests, and the network
            // does not promise they come back in order.
            guard thisGeneration == generation else { return }

            cursor = page.nextCursor
            state.patients = page.items
            state.hasMore = page.nextCursor != nil
            state.phase = page.items.isEmpty ? .empty : .loaded
        } catch {
            guard thisGeneration == generation else { return }
            apply(error)
        }
    }

    /// Appends the next page. Safe to call repeatedly from a scroll handler:
    /// it does nothing while a page is already loading or when the end has
    /// been reached.
    public func loadMore() async {
        guard state.hasMore, !state.isLoadingMore, let cursor else { return }

        let thisGeneration = generation
        state.isLoadingMore = true

        do {
            let page = try await api.search(
                PatientSearch(query: state.query, cursor: cursor, limit: pageSize)
            )

            // A page that arrives after the user started a new search belongs
            // to a list that no longer exists.
            guard thisGeneration == generation else { return }

            self.cursor = page.nextCursor
            state.patients.append(contentsOf: page.items)
            state.hasMore = page.nextCursor != nil
            state.isLoadingMore = false
        } catch {
            guard thisGeneration == generation else { return }

            state.isLoadingMore = false
            // The pages already on screen stay: losing them because page three
            // failed would be worse than showing what we have.
            if case APIError.offline = error {
                state.phase = .failed(L10n.string("error.offline"))
            }
        }
    }

    public func retry() async {
        await search(query: state.query)
    }

    private func apply(_ error: Error) {
        state.patients = []
        state.hasMore = false

        guard let apiError = error as? APIError else {
            state.phase = .failed(L10n.string("error.server"))
            return
        }

        state.phase = .failed(L10n.message(for: apiError))
    }
}

import Foundation

/// A response that was read from disk rather than from the clinic.
public struct CachedResponse: Sendable, Equatable {
    public let body: Data
    public let storedAt: Date

    public init(body: Data, storedAt: Date) {
        self.body = body
        self.storedAt = storedAt
    }
}

/**
 * The last successful answer to each read.
 *
 * Spec M15 asks the app to keep working without a connection. This is the
 * smaller, honest half of that: reads still come from the server when there is
 * one, and fall back to what was last seen when there is not — rather than
 * showing a patient in a hotel with no signal an error where their discharge
 * instructions should be.
 *
 * Only `GET` is cached, and only whole responses. Nothing is merged, nothing is
 * reconstructed, and a cached answer is always labelled as one on screen: a
 * stale measurement presented as current is worse than no measurement.
 */
public protocol ResponseCache: Sendable {
    func store(_ body: Data, for key: String) async
    func load(for key: String) async -> CachedResponse?
    /// Called when the session changes. A cache that outlived a sign-out would
    /// show one user's record to the next.
    func clear() async
}

/// The cache key for a request. Method and path plus the query, sorted, so two
/// requests that differ only in parameter order share one entry.
public func cacheKey(method: HTTPMethod, path: String, query: [String: String]) -> String {
    let sorted = query
        .sorted { $0.key < $1.key }
        .map { "\($0.key)=\($0.value)" }
        .joined(separator: "&")

    return sorted.isEmpty ? "\(method.rawValue) \(path)" : "\(method.rawValue) \(path)?\(sorted)"
}

/// Where the client says what happened, so the shell can put it on screen.
///
/// A protocol rather than a callback so the observer can be an actor or a main-
/// actor object without the client knowing which.
public protocol ConnectionObserver: Sendable {
    /// A read reached the clinic.
    func reachedServer() async
    /// A read failed and was served from disk instead.
    func servedFromCache(storedAt: Date) async
    /// A read failed and there was nothing on disk to serve.
    func couldNotReachServer() async
}

/// An in-memory cache. Used by tests and as the fallback when the database
/// cannot be opened — the app then behaves exactly as it did before, which is
/// the right failure for a convenience.
public actor InMemoryResponseCache: ResponseCache {
    private var entries: [String: CachedResponse] = [:]

    public init() {}

    public func store(_ body: Data, for key: String) async {
        entries[key] = CachedResponse(body: body, storedAt: Date())
    }

    public func load(for key: String) async -> CachedResponse? { entries[key] }

    public func clear() async { entries.removeAll() }
}

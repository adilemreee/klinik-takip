import Foundation
import KlinikCore

public struct HTTPResponse: Sendable {
    public let status: Int
    public let body: Data
    public let headers: [String: String]

    public init(status: Int, body: Data, headers: [String: String] = [:]) {
        self.status = status
        self.body = body
        self.headers = headers
    }
}

/// The one place the client touches the network.
///
/// Behind a protocol so every layer above it — retries, refresh, error mapping —
/// is tested against recorded responses instead of a live server.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> HTTPResponse

    /// Sends a request whose body is a file on disk.
    ///
    /// Separate from `send` so the real transport can stream it. The default
    /// reads the file in, which is fine for a test double and would not be for
    /// a 20 MB scan on a phone.
    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> HTTPResponse
}

public extension HTTPTransport {
    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> HTTPResponse {
        var buffered = request
        buffered.httpBody = try Data(contentsOf: fileURL)
        return try await send(buffered)
    }
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = URLSessionTransport.configured()) {
        self.session = session
    }

    /**
     * The session this app talks through.
     *
     * `URLSession.shared` waits sixty seconds before giving up, and the whole
     * offline story rests on failing fast: a patient on a hotel connection that
     * accepts the TCP handshake and then goes quiet should see the queue take
     * their reading, not a minute of frozen screen. Fifteen seconds is longer
     * than any request this app makes takes to answer, and short enough that
     * "no answer" is a verdict rather than a wait.
     *
     * The resource timeout is the outer bound for a whole transfer, which is
     * why it is much larger: a 20 MB scan is slow on purpose, not stalled.
     */
    public static func configured() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 120
        // A cache in front of an API that already has its own, keyed per user
        // and emptied at sign-out, would be a second copy of clinical data with
        // nobody's rules on it.
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData

        return URLSession(configuration: configuration)
    }

    public func send(_ request: URLRequest) async throws -> HTTPResponse {
        try await perform { try await session.data(for: request) }
    }

    /// Streamed from disk by URLSession, so the body is never resident in memory.
    public func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> HTTPResponse {
        try await perform { try await session.upload(for: request, fromFile: fileURL) }
    }

    private func perform(
        _ work: () async throws -> (Data, URLResponse)
    ) async throws -> HTTPResponse {
        do {
            let (data, response) = try await work()

            guard let http = response as? HTTPURLResponse else {
                throw APIError.unknown(status: 0)
            }

            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                if let key = key as? String, let value = value as? String {
                    headers[key.lowercased()] = value
                }
            }

            return HTTPResponse(status: http.statusCode, body: data, headers: headers)
        } catch let error as URLError {
            throw URLSessionTransport.failure(for: error)
        }
    }

    /**
     * What a `URLError` means to the rest of the app.
     *
     * Connectivity is a different situation from a server failure: the UI shows
     * an offline state and the queue keeps the write (spec M15). Getting this
     * mapping wrong is not a cosmetic mistake — a failure filed as "unknown"
     * skips the queue and the cache both, and the reading the patient typed is
     * gone.
     *
     * So the default is `offline`, not `unknown`. Every `URLError` means the
     * request did not reach a server and come back; the named cases below are
     * the ones worth being explicit about because they are the ones a hotel
     * connection, a captive portal and a phone with roaming switched off
     * actually produce — and `notConnectedToInternet`, the case that used to be
     * the whole list, fires only in aeroplane mode.
     */
    static func failure(for error: URLError) -> APIError {
        switch error.code {
        case .timedOut:
            return .timedOut

        case .notConnectedToInternet,
             .networkConnectionLost,
             .dataNotAllowed,
             .internationalRoamingOff,
             .callIsActive,
             .cannotConnectToHost,
             .cannotFindHost,
             .dnsLookupFailed,
             .resourceUnavailable,
             .cannotLoadFromNetwork,
             .secureConnectionFailed,
             .serverCertificateUntrusted,
             .serverCertificateHasBadDate,
             .serverCertificateNotYetValid,
             .serverCertificateHasUnknownRoot:
            return .offline

        case .cancelled:
            // Somebody navigated away. Not a failure to report, and certainly
            // not one to queue a second copy of the write for.
            return .unknown(status: error.errorCode)

        default:
            return .offline
        }
    }
}

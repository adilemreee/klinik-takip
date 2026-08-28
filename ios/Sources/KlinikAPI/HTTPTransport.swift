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
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> HTTPResponse {
        do {
            let (data, response) = try await session.data(for: request)

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
            // Connectivity is a different situation from a server failure: the
            // UI shows an offline state and queues the work (spec M15).
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                throw APIError.offline
            case .timedOut:
                throw APIError.timedOut
            default:
                throw APIError.unknown(status: error.errorCode)
            }
        }
    }
}

import Foundation
import KlinikCore

public struct APIConfiguration: Sendable {
    public let baseURL: URL
    /// Sent as `Accept-Language`, so the backend can localise what it returns.
    public let preferredLanguage: String

    public init(baseURL: URL, preferredLanguage: String = "tr") {
        self.baseURL = baseURL
        self.preferredLanguage = preferredLanguage
    }
}

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

public struct Endpoint: Sendable {
    public let method: HTTPMethod
    public let path: String
    public let query: [String: String]
    public let body: Data?
    /// Overrides the request's Content-Type. Raw chunk uploads are not JSON.
    public let contentType: String?
    /// Endpoints that must not carry a token — sign-in, refresh, invitation
    /// redemption. Attaching an expired token to these would trigger a pointless
    /// refresh, and refreshing to call refresh is a loop.
    public let requiresAuthentication: Bool

    /// A specific bearer token to send instead of the session's.
    ///
    /// Two-factor enrolment is reached with the scoped setup token, which is a
    /// bearer credential but not a session: there is nothing to refresh, and a
    /// 401 on it means the five minutes elapsed, not that a session expired.
    public let bearerOverride: String?

    public init(
        method: HTTPMethod,
        path: String,
        query: [String: String] = [:],
        body: Data? = nil,
        contentType: String? = nil,
        requiresAuthentication: Bool = true,
        bearerOverride: String? = nil
    ) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.contentType = contentType
        self.requiresAuthentication = requiresAuthentication
        self.bearerOverride = bearerOverride
    }
}

/// The networking layer.
///
/// Responsibilities kept deliberately narrow: build the request, attach a valid
/// token, map failures to `APIError`, and retry exactly once after a 401.
public actor APIClient {
    private let configuration: APIConfiguration
    private let transport: HTTPTransport
    private let session: SessionManager

    public init(configuration: APIConfiguration, transport: HTTPTransport, session: SessionManager) {
        self.configuration = configuration
        self.transport = transport
        self.session = session
    }

    public func send<Response: Decodable & Sendable>(
        _ endpoint: Endpoint,
        as type: Response.Type
    ) async throws -> Response {
        let data = try await sendRaw(endpoint)

        do {
            return try JSONDecoder.klinik.decode(Response.self, from: emptyAsNull(data))
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /**
     * An empty body, read as `null`.
     *
     * Several endpoints answer 200 with nothing in it to mean "there is none" —
     * a patient with no check-up schedule yet, no open emergency. Empty data is
     * not valid JSON, so decoding it throws, and the screen shows "something
     * went wrong" to somebody whose only problem is that they have no schedule.
     *
     * Substituting `null` puts the decision where it belongs, in the type: an
     * optional Response decodes to nil, and a Response that is *not* optional
     * still throws — because an empty body where a value was required really is
     * an error.
     */
    private func emptyAsNull(_ data: Data) -> Data {
        data.isEmpty ? Data("null".utf8) : data
    }

    /// For the endpoints that answer 204.
    public func send(_ endpoint: Endpoint) async throws {
        _ = try await sendRaw(endpoint)
    }

    /// Sends a multipart body streamed from disk.
    ///
    /// The envelope is assembled in a temporary file and removed afterwards
    /// whatever happens — a failed upload that leaves a 20 MB copy behind fills
    /// the device one attempt at a time.
    public func upload<Response: Decodable & Sendable>(
        _ endpoint: Endpoint,
        multipart: MultipartBody,
        as type: Response.Type
    ) async throws -> Response {
        let envelope = try multipart.writeToTemporaryFile()
        defer { try? FileManager.default.removeItem(at: envelope) }

        let response = try await perform(
            endpoint,
            retryAfterRefresh: true,
            contentType: multipart.headerValue,
            bodyFile: envelope
        )

        do {
            return try JSONDecoder.klinik.decode(Response.self, from: response.body)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    private func sendRaw(_ endpoint: Endpoint) async throws -> Data {
        let response = try await perform(endpoint, retryAfterRefresh: true)
        return response.body
    }

    private func perform(
        _ endpoint: Endpoint,
        retryAfterRefresh: Bool,
        contentType: String? = nil,
        bodyFile: URL? = nil
    ) async throws -> HTTPResponse {
        var token: String?

        if let override = endpoint.bearerOverride {
            token = override
        } else if endpoint.requiresAuthentication {
            token = try await session.validAccessToken()
        }

        let request = try buildRequest(endpoint, token: token, contentType: contentType)
        let response: HTTPResponse

        if let bodyFile {
            response = try await transport.upload(request, fromFile: bodyFile)
        } else {
            response = try await transport.send(request)
        }

        if (200...299).contains(response.status) {
            return response
        }

        // One retry, and only for a 401 on an authenticated request. Retrying
        // more would spend refresh tokens the backend treats as single-use.
        //
        // The token that failed is handed back, so a request that queued behind
        // another one's refresh does not trigger a second, pointless refresh.
        // An overridden bearer is not a session, so a 401 on it is final: there
        // is nothing to refresh into.
        if response.status == 401, endpoint.requiresAuthentication, endpoint.bearerOverride == nil,
           retryAfterRefresh, let token {
            _ = try await session.refreshAfterUnauthorized(usedAccessToken: token)
            return try await perform(
                endpoint,
                retryAfterRefresh: false,
                contentType: contentType,
                bodyFile: bodyFile
            )
        }

        throw mapFailure(response)
    }

    private func buildRequest(
        _ endpoint: Endpoint,
        token: String?,
        contentType: String? = nil
    ) throws -> URLRequest {
        guard var components = URLComponents(
            url: configuration.baseURL.appendingPathComponent(endpoint.path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.unknown(status: 0)
        }

        if !endpoint.query.isEmpty {
            // Sorted so a request is reproducible — which matters for caching,
            // for logs, and for tests.
            components.queryItems = endpoint.query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }

        guard let url = components.url else {
            throw APIError.unknown(status: 0)
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.httpBody = endpoint.body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(configuration.preferredLanguage, forHTTPHeaderField: "Accept-Language")

        if let contentType = contentType ?? endpoint.contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        } else if endpoint.body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return request
    }

    private func mapFailure(_ response: HTTPResponse) -> APIError {
        let body = (try? JSONDecoder.klinik.decode(ErrorResponse.self, from: response.body))
            ?? ErrorResponse(statusCode: response.status, message: "")

        let retryAfter = response.headers["retry-after"].flatMap(TimeInterval.init)

        return APIError.from(status: response.status, body: body, retryAfter: retryAfter)
    }
}

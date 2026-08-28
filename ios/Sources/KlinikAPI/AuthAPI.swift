import Foundation
import KlinikCore

public struct LoginRequest: Encodable, Sendable {
    public let identifier: String
    public let password: String
    public let totpCode: String?
    public let deviceName: String?
    public let platform: String?

    public init(
        identifier: String,
        password: String,
        totpCode: String? = nil,
        deviceName: String? = nil,
        platform: String? = "ios"
    ) {
        self.identifier = identifier
        self.password = password
        self.totpCode = totpCode
        self.deviceName = deviceName
        self.platform = platform
    }
}

public struct LoginResponse: Decodable, Sendable {
    public enum Status: String, Decodable, Sendable {
        case ok = "OK"
        case mfaRequired = "MFA_REQUIRED"
        case mfaSetupRequired = "MFA_SETUP_REQUIRED"
    }

    public let status: Status
    public let accessToken: String?
    public let refreshToken: String?
    public let expiresIn: Int?
    /// Present only with `mfaSetupRequired`. Accepted solely by the enrolment
    /// endpoints, and expires in five minutes.
    public let setupToken: String?

    /// Tokens, when the response actually carries a session.
    public func tokens(now: Date = Date()) -> SessionTokens? {
        guard let accessToken, let refreshToken, let expiresIn else {
            return nil
        }

        return SessionTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: now.addingTimeInterval(TimeInterval(expiresIn))
        )
    }
}

public struct TokensResponse: Decodable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int

    public func tokens(now: Date = Date()) -> SessionTokens {
        SessionTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: now.addingTimeInterval(TimeInterval(expiresIn))
        )
    }
}

public struct DeviceSession: Decodable, Sendable, Identifiable {
    public let familyId: String
    public let deviceName: String?
    public let platform: String?
    public let ipAddress: String?
    public let lastSeenAt: Date
    public let current: Bool

    public var id: String { familyId }
}

public struct TotpSetup: Decodable, Sendable {
    public let secret: String
    public let uri: String
}

/// Authentication calls.
///
/// Refresh lives here too, but it is reached through `SessionManager` rather
/// than called directly: the backend treats refresh tokens as single-use, so
/// exactly one refresh may be in flight at a time.
public struct AuthAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func login(_ request: LoginRequest) async throws -> LoginResponse {
        try await client.send(
            Endpoint(
                method: .post,
                path: "auth/login",
                body: try JSONEncoder.klinik.encode(request),
                requiresAuthentication: false
            ),
            as: LoginResponse.self
        )
    }

    /// Starts enrolment. Reached with the scoped setup token when the account
    /// has no second factor yet, or with a session token when a patient opts in.
    public func beginTotpEnrolment(setupToken: String? = nil) async throws -> TotpSetup {
        try await client.send(
            Endpoint(method: .post, path: "auth/2fa/setup", bearerOverride: setupToken),
            as: TotpSetup.self
        )
    }

    public func confirmTotpEnrolment(code: String, setupToken: String? = nil) async throws {
        try await client.send(
            Endpoint(
                method: .post,
                path: "auth/2fa/confirm",
                body: try JSONEncoder.klinik.encode(["code": code]),
                bearerOverride: setupToken
            )
        )
    }

    public func sessions() async throws -> [DeviceSession] {
        try await client.send(Endpoint(method: .get, path: "auth/sessions"), as: [DeviceSession].self)
    }

    public func signOut() async throws {
        try await client.send(Endpoint(method: .post, path: "auth/logout"))
    }

    public func signOutEverywhere() async throws {
        try await client.send(Endpoint(method: .post, path: "auth/logout-all"))
    }

    public func revokeSession(familyId: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "auth/sessions/\(familyId)"))
    }
}

/// Refreshes without going through `APIClient`, which would need a valid token
/// to obtain one — a loop.
public struct HTTPTokenRefresher: TokenRefresher {
    private let baseURL: URL
    private let transport: HTTPTransport

    public init(baseURL: URL, transport: HTTPTransport) {
        self.baseURL = baseURL
        self.transport = transport
    }

    public func refresh(using refreshToken: String) async throws -> SessionTokens {
        var request = URLRequest(url: baseURL.appendingPathComponent("auth/refresh"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder.klinik.encode(["refreshToken": refreshToken])

        let response = try await transport.send(request)

        guard (200...299).contains(response.status) else {
            let body = (try? JSONDecoder.klinik.decode(ErrorResponse.self, from: response.body))
                ?? ErrorResponse(statusCode: response.status, message: "")
            throw APIError.from(status: response.status, body: body)
        }

        return try JSONDecoder.klinik.decode(TokensResponse.self, from: response.body).tokens()
    }
}

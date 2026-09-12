import Foundation

/// The error body every backend failure uses.
public struct ErrorResponse: Codable, Sendable, Equatable {
    public let statusCode: Int
    public let message: String
    public let error: String?

    /// How long a lockout has left. Present only on ACCOUNT_LOCKED.
    public let retryAfterSeconds: Int?

    private enum CodingKeys: String, CodingKey {
        case statusCode, message, error, retryAfterSeconds
    }

    public init(
        statusCode: Int,
        message: String,
        error: String? = nil,
        retryAfterSeconds: Int? = nil
    ) {
        self.statusCode = statusCode
        self.message = message
        self.error = error
        self.retryAfterSeconds = retryAfterSeconds
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        statusCode = try container.decodeIfPresent(Int.self, forKey: .statusCode) ?? 0
        error = try container.decodeIfPresent(String.self, forKey: .error)
        retryAfterSeconds = try container.decodeIfPresent(Int.self, forKey: .retryAfterSeconds)

        // Validation failures arrive as an array of messages; everything else
        // as a single string. Both reach the UI as one field.
        if let single = try? container.decode(String.self, forKey: .message) {
            message = single
        } else if let many = try? container.decode([String].self, forKey: .message) {
            message = many.joined(separator: "\n")
        } else {
            message = ""
        }
    }
}

/// Machine-readable codes the backend returns on the authentication path.
public enum AuthErrorCode: String, Sendable {
    case invalidCredentials = "INVALID_CREDENTIALS"
    case accountLocked = "ACCOUNT_LOCKED"
    case accountInactive = "ACCOUNT_INACTIVE"
    case mfaRequired = "MFA_REQUIRED"
    case mfaInvalid = "MFA_INVALID"
    case mfaSetupRequired = "MFA_SETUP_REQUIRED"
    case invitationInvalid = "INVITATION_INVALID"
    case invitationExpired = "INVITATION_EXPIRED"
    case invitationAttemptsExceeded = "INVITATION_ATTEMPTS_EXCEEDED"
    case passwordTooWeak = "PASSWORD_TOO_WEAK"
}

public enum APIError: Error, Sendable, Equatable {
    /// No usable connection. Distinct from a server failure because the UI
    /// offers a different remedy (spec M15: the offline indicator).
    case offline
    case timedOut
    /// Recognised authentication outcome; the UI branches on the code.
    case auth(AuthErrorCode, ErrorResponse)
    case unauthorized(ErrorResponse)
    case forbidden(ErrorResponse)
    /// Also returned for a record outside the caller's scope — the backend
    /// deliberately makes the two indistinguishable, so the client must not
    /// tell the user the record exists.
    case notFound(ErrorResponse)
    case validation(ErrorResponse)
    case conflict(ErrorResponse)
    case rateLimited(retryAfter: TimeInterval?)
    case server(ErrorResponse)
    case decoding(String)
    case unknown(status: Int)

    /**
     * The write could not be delivered and was kept to be sent later.
     *
     * Thrown rather than returned because there is no answer to return: the
     * server has not seen the change, so there is no record, no id and no
     * timestamp to hand back. The screen that catches this tells the user
     * their work is saved and not yet sent — which is the truth, and is
     * neither the success nor the failure the other cases describe.
     */
    case queuedForLater

    /**
     * Whether the clinic was unreachable, as opposed to unwilling.
     *
     * The distinction decides whether a stale copy may be shown: a server that
     * answered "no" gave an answer, and replacing it with yesterday's "yes"
     * would be the client overruling the clinic.
     */
    public var isConnectivity: Bool {
        self == .offline || self == .timedOut
    }

    /// Whether retrying the same request unchanged could plausibly succeed.
    public var isRetryable: Bool {
        switch self {
        case .offline, .timedOut, .rateLimited, .server:
            return true
        default:
            return false
        }
    }

    /// Whether the session is over and the user has to sign in again.
    public var requiresReauthentication: Bool {
        switch self {
        case .unauthorized:
            return true
        case .auth(let code, _):
            return code == .accountInactive || code == .accountLocked
        default:
            return false
        }
    }
}

public extension APIError {
    /// Maps a response to the case the UI branches on.
    static func from(status: Int, body: ErrorResponse, retryAfter: TimeInterval? = nil) -> APIError {
        if let code = AuthErrorCode(rawValue: body.message) {
            return .auth(code, body)
        }

        switch status {
        case 400, 422: return .validation(body)
        case 401: return .unauthorized(body)
        case 403: return .forbidden(body)
        case 404: return .notFound(body)
        case 409: return .conflict(body)
        case 429: return .rateLimited(retryAfter: retryAfter)
        case 500...599: return .server(body)
        default: return .unknown(status: status)
        }
    }
}

public extension APIError {
    /// Whether the server refused, as opposed to failing to answer at all.
    var isRefusal: Bool {
        if case .forbidden = self { return true }

        return false
    }
}

/// A best-effort read: what came back, or why nothing did.
///
/// `try?` throws the reason away, and several screens then read "nothing came
/// back from any of these" as "this account may not see the panel". That is
/// true of a 403 and of nothing else — an unreachable clinic, a 500, or a
/// response the app cannot parse would all be reported to a finance officer as
/// a permission problem, on a screen with no way to try again.
public enum Attempted<Value: Sendable>: Sendable {
    case arrived(Value)
    case failed(APIError)

    public var value: Value? {
        if case .arrived(let value) = self { return value }

        return nil
    }

    public var error: APIError? {
        if case .failed(let error) = self { return error }

        return nil
    }
}

/// Runs a read that is allowed to fail, keeping the reason.
public func attempt<Value: Sendable>(
    _ work: @Sendable () async throws -> Value
) async -> Attempted<Value> {
    do {
        return .arrived(try await work())
    } catch let error as APIError {
        return .failed(error)
    } catch {
        return .failed(.unknown(status: 0))
    }
}

/// What a screen should show when every one of its reads came back empty.
public enum ReadOutcome: Sendable, Equatable {
    /// Every failure was a refusal: this account may not see the screen.
    case refused
    /// Something else went wrong. Worth saying what, and worth a retry.
    case failed(String)

    public static func of(_ errors: [APIError]) -> ReadOutcome {
        guard let reason = errors.first(where: { !$0.isRefusal }) else { return .refused }

        return .failed(L10n.message(for: reason))
    }
}

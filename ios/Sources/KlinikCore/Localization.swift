import Foundation

/// Every user-facing string comes from here (spec section 7: no text embedded
/// in code).
///
/// The keys are namespaced by area so a missing translation is obvious in a
/// diff, and so the same key can be reused by both clients.
public enum L10n {
    public static func string(_ key: String) -> String {
        string(key, bundle: .module)
    }

    /// Bundle-explicit form, used by the tests to read a specific language.
    ///
    /// The key itself is the fallback: an untranslated string shows as
    /// "patient.searchHint" rather than silently appearing in the wrong
    /// language, which is what an empty default would do.
    static func string(_ key: String, bundle: Bundle) -> String {
        NSLocalizedString(key, bundle: bundle, value: key, comment: "")
    }

    /// The bundle carrying the string catalogues, exposed for tests.
    static var resourceBundle: Bundle { .module }

    /// Message for an error, chosen from the same catalogue as everything else
    /// so nothing reaches a patient in English by accident.
    public static func message(for error: APIError) -> String {
        switch error {
        case .offline:
            return string("error.offline")
        case .timedOut:
            return string("error.timedOut")
        case .notFound:
            return string("error.notFound")
        case .forbidden:
            return string("error.forbidden")
        case .server, .unknown, .decoding, .rateLimited:
            return string("error.server")
        case .auth(let code, _):
            return string(key(for: code))
        case .unauthorized:
            // Outside the sign-in screen a 401 means the session ended, not
            // that a password was mistyped. Telling a nurse mid-shift that her
            // password is wrong sends her to change something that is fine.
            // Wrong credentials arrive as .auth(.invalidCredentials, _).
            return string("error.sessionExpired")
        case .validation(let body):
            // Validation text comes from the server, which localises by
            // Accept-Language; showing it beats a generic message.
            return body.message.isEmpty ? string("error.server") : body.message
        case .conflict(let body):
            return body.message.isEmpty ? string("error.server") : body.message
        }
    }

    private static func key(for code: AuthErrorCode) -> String {
        switch code {
        case .invalidCredentials: return "auth.error.invalidCredentials"
        case .accountLocked: return "auth.error.accountLocked"
        case .accountInactive: return "auth.error.accountInactive"
        case .mfaInvalid, .mfaRequired, .mfaSetupRequired: return "auth.error.mfaInvalid"
        case .passwordTooWeak: return "auth.error.passwordTooWeak"
        case .invitationInvalid, .invitationExpired, .invitationAttemptsExceeded:
            return "error.server"
        }
    }
}

import Foundation

/**
 * What the server will accept as a password.
 *
 * Mirrored here so somebody choosing one is told before they submit rather
 * than after — a rejection that arrives from the network, on a form they have
 * just filled in twice, reads as the app being broken.
 *
 * The server remains the authority: it also refuses common passwords and
 * anything containing the user's own name or address, which this cannot check
 * without shipping a word list or knowing the account. What this catches is
 * the two rules somebody can act on while typing.
 */
public enum PasswordRules {
    /// Matches `MIN_LENGTH` in the backend's password policy.
    public static let minimumLength = 12

    /// Why this password would be refused, in the reader's language. Empty
    /// means nothing here objects — which is not a promise the server will not.
    public static func problems(with password: String, identifier: String = "") -> [String] {
        var found: [String] = []

        if password.count < minimumLength {
            found.append(String(format: L10n.string("password.rule.length"), minimumLength))
        }

        let hasLetter = password.contains { $0.isLetter }
        let hasDigit = password.contains { $0.isNumber }

        if !hasLetter || !hasDigit {
            found.append(L10n.string("password.rule.lettersAndDigits"))
        }

        // The one piece of personal data the form already has in front of it.
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if trimmed.count >= 4, password.lowercased().contains(trimmed) {
            found.append(L10n.string("password.rule.notYourIdentifier"))
        }

        return found
    }

    /// Whether the form may be submitted. Not whether the server will accept it.
    public static func looksAcceptable(_ password: String, identifier: String = "") -> Bool {
        problems(with: password, identifier: identifier).isEmpty
    }
}

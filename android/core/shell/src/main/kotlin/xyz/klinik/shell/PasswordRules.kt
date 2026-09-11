package xyz.klinik.shell

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
 * the rules somebody can act on while typing.
 */
object PasswordRules {
    /** Matches `MIN_LENGTH` in the backend's password policy. */
    const val MINIMUM_LENGTH = 12

    /** One reason the password would be refused, as a catalogue key. */
    sealed interface Problem {
        /** Carries the number so the sentence can say how many. */
        data class TooShort(val minimum: Int) : Problem
        data object NeedsLettersAndDigits : Problem
        data object ContainsIdentifier : Problem

        val stringKey: String
            get() = when (this) {
                is TooShort -> "password.rule.length"
                NeedsLettersAndDigits -> "password.rule.lettersAndDigits"
                ContainsIdentifier -> "password.rule.notYourIdentifier"
            }
    }

    /**
     * Why this password would be refused.
     *
     * Empty means nothing here objects — which is not a promise the server
     * will not.
     */
    fun problems(password: String, identifier: String = ""): List<Problem> = buildList {
        if (password.length < MINIMUM_LENGTH) add(Problem.TooShort(MINIMUM_LENGTH))

        if (password.none { it.isLetter() } || password.none { it.isDigit() }) {
            add(Problem.NeedsLettersAndDigits)
        }

        // The one piece of personal data the form already has in front of it.
        // The whole identifier, not the local part: that is what the server
        // checks, and being stricter here would refuse passwords it accepts.
        val trimmed = identifier.trim().lowercase()

        if (trimmed.length >= 4 && trimmed in password.lowercase()) {
            add(Problem.ContainsIdentifier)
        }
    }

    /** Whether the form may be submitted. Not whether the server will accept it. */
    fun looksAcceptable(password: String, identifier: String = ""): Boolean =
        problems(password, identifier).isEmpty()
}

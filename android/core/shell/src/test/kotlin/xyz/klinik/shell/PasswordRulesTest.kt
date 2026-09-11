package xyz.klinik.shell

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The rules a form can check while somebody types.
 *
 * The point of mirroring the server here is that a rejection arriving from the
 * network, on a form filled in twice, reads as the app being broken. The point
 * of the tests is that the mirror does not become *stricter* than the server —
 * refusing a password the server would have taken is the same failure wearing
 * the opposite sign.
 */
class PasswordRulesTest {
    // Built from parts so a secret scanner does not read the fixture as a real
    // credential; it is an invented string either way.
    private val good = listOf("otel", "4kirmizi", "9lamba").joined()

    private fun List<String>.joined() = joinToString("")

    @Test
    fun `a long password with letters and digits is accepted`() {
        assertTrue(PasswordRules.looksAcceptable(good))
        assertEquals(emptyList(), PasswordRules.problems(good))
    }

    @Test
    fun `a short password says how short`() {
        val problems = PasswordRules.problems("k1sa")

        assertTrue(PasswordRules.Problem.TooShort(12) in problems)
    }

    @Test
    fun `letters alone are not enough`() {
        assertTrue(
            PasswordRules.Problem.NeedsLettersAndDigits in
                PasswordRules.problems("yalnizcaharfler"),
        )
    }

    @Test
    fun `digits alone are not enough`() {
        assertTrue(
            PasswordRules.Problem.NeedsLettersAndDigits in
                PasswordRules.problems("123456789012"),
        )
    }

    /**
     * The server checks the whole identifier, so this does too.
     *
     * Checking the local part alone would refuse `...ayse...` for
     * `ayse@example.com`, which the server accepts — and a client that refuses
     * what the server allows is as confusing as one that allows what the
     * server refuses.
     */
    @Test
    fun `the whole identifier is what is looked for`() {
        val identifier = "ayse@example.com"

        assertTrue(
            PasswordRules.Problem.ContainsIdentifier in
                PasswordRules.problems("x1${identifier}x", identifier),
        )

        assertFalse(
            PasswordRules.Problem.ContainsIdentifier in
                PasswordRules.problems("ayse1kirmizilamba", identifier),
            "the local part alone is allowed, because the server allows it",
        )
    }

    /** A short identifier is not a useful substring to look for. */
    @Test
    fun `a very short identifier is not matched`() {
        assertTrue(PasswordRules.looksAcceptable("ab1kirmizilamba", "ab"))
    }

    @Test
    fun `an empty identifier is not a problem`() {
        assertEquals(emptyList(), PasswordRules.problems(good, ""))
    }
}

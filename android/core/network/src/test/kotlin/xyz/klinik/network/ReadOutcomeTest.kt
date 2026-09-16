package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest

/**
 * Telling somebody they have no permission is a claim about them.
 *
 * Screens that fire several best-effort reads used to treat "nothing came
 * back" as "this account may not see the panel". That is true of a 403 and of
 * nothing else: an unreachable clinic, a 500, or a response the app cannot
 * parse all read the same way, and the screen offered no retry.
 */
class ReadOutcomeTest {
    private val refused = ApiError.Forbidden(ErrorResponse(statusCode = 403))

    @Test
    fun `every failure being a refusal is a refusal`() {
        assertEquals(ReadOutcome.Refused, ReadOutcome.of(listOf(refused, refused)))
    }

    @Test
    fun `one ordinary failure makes it a failure`() {
        val outcome = ReadOutcome.of(listOf(refused, ApiError.Offline))

        assertIs<ReadOutcome.Failed>(outcome)
        assertEquals(UiText.Key("error.offline"), outcome.message)
    }

    /** A response the app cannot parse is a fault at one end or the other, and
     *  never evidence about what the reader is allowed to see. */
    @Test
    fun `a decoding failure is not a refusal`() {
        assertIs<ReadOutcome.Failed>(ReadOutcome.of(listOf(ApiError.Decoding("age"))))
    }

    @Test
    fun `attempt keeps the reason`() = runTest {
        val outcome = attempt<Int> { throw ApiError.Offline }

        assertNull(outcome.value)
        assertEquals(ApiError.Offline, outcome.error)
    }

    @Test
    fun `attempt carries the value through`() = runTest {
        val outcome = attempt { 7 }

        assertEquals(7, outcome.value)
        assertNull(outcome.error)
    }
}

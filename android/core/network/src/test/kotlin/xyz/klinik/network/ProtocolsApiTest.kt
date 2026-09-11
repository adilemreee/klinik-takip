package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * What the assistant is allowed to answer from (spec M4).
 *
 * The interesting state is a document that was accepted and cannot be
 * retrieved: stored, listed, and invisible to the thing it was uploaded for.
 */
class ProtocolsApiTest {
    private fun summary(active: Boolean, embedded: Boolean, chunks: Int) = """
        {"document":{"id":"d1","title":"Taburculuk talimatları","procedureType":"rhinoplasty",
          "language":"tr","isActive":$active,"createdAt":"2026-09-01T08:00:00.000Z"},
         "chunks":$chunks,"embedded":$embedded}
    """.trimIndent()

    @Test
    fun `a document the assistant can use says so`() {
        val protocol = json.decodeFromString<ProtocolSummary>(summary(true, true, 12))

        assertTrue(protocol.isUsable)
        assertEquals("rhinoplasty", protocol.document.procedureType)
    }

    /**
     * Accepted and unreachable.
     *
     * With no embedding provider configured the text is stored and the
     * assistant cannot retrieve it, so a list that showed only "uploaded"
     * would show a clinic a protocol its assistant has never read.
     */
    @Test
    fun `a document with no embedding is not usable`() {
        val protocol = json.decodeFromString<ProtocolSummary>(summary(true, false, 12))

        assertFalse(protocol.isUsable)
        assertFalse(protocol.embedded)
    }

    /** Withdrawn is withdrawn, however well it was indexed. */
    @Test
    fun `an inactive document is not usable`() {
        assertFalse(json.decodeFromString<ProtocolSummary>(summary(false, true, 12)).isUsable)
    }

    /** Nothing was split out of it, so there is nothing to retrieve. */
    @Test
    fun `a document with no chunks is not usable`() {
        assertFalse(json.decodeFromString<ProtocolSummary>(summary(true, true, 0)).isUsable)
    }

    /** General advice has no procedure, and that is a value rather than a gap. */
    @Test
    fun `a document with no procedure applies to everybody`() {
        val protocol = json.decodeFromString<ProtocolSummary>(
            summary(true, true, 4).replace("\"procedureType\":\"rhinoplasty\"", "\"procedureType\":null"),
        )

        assertEquals(null, protocol.document.procedureType)
        assertTrue(protocol.isUsable)
    }
}

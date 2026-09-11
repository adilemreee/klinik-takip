package xyz.klinik.feature.documents

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.DocumentsApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.RecordSubject
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object ChecklistRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the checklist must not refresh a session")
}

private class ChecklistTransport(private val bodies: Map<String, Pair<Int, String>>) :
    HttpTransport {
    val paths = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        paths += path

        val (status, body) = bodies[path.substringBefore("?")] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun item(type: String, label: String, mandatory: Boolean, satisfied: Boolean) = """
    {"documentType":"$type","label":"$label","mandatory":$mandatory,
     "satisfied":$satisfied,"documentId":${if (satisfied) "\"d1\"" else "null"}}
""".trimIndent()

/**
 * What the clinic still needs before the operation (spec M17).
 *
 * Two things matter: the list keeps what has arrived, and what is stopping the
 * operation is at the top of what has not.
 */
class ChecklistModelTest {
    private suspend fun model(
        transport: ChecklistTransport,
        subject: RecordSubject = RecordSubject.Me,
    ): ChecklistModel {
        val session = SessionManager(InMemoryTokenStore(), ChecklistRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return ChecklistModel(
            DocumentsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            subject,
        )
    }

    /**
     * A missing passport outranks an optional insurance form.
     *
     * Otherwise the list buries the thing actually stopping the operation.
     */
    @Test
    fun `what is mandatory and missing comes first`() = runTest {
        val subject = model(
            ChecklistTransport(
                mapOf(
                    "me/documents/checklist" to (
                        200 to """
                        {"items":[${item("OTHER", "Sigorta", false, false)},
                                  ${item("PASSPORT", "Pasaport", true, false)},
                                  ${item("LAB", "Tahlil", true, true)}],
                         "missingMandatory":1,"complete":false}
                        """.trimIndent()
                        ),
                ),
            ),
        )

        subject.load()

        assertEquals(
            listOf("Pasaport", "Sigorta"),
            subject.state.value.outstanding.map { it.label },
        )
    }

    /**
     * What has arrived stays on the list.
     *
     * Otherwise a patient cannot tell "you have sent everything" from "the
     * list did not load", and the first is what they came to find out.
     */
    @Test
    fun `documents already received are still listed`() = runTest {
        val subject = model(
            ChecklistTransport(
                mapOf(
                    "me/documents/checklist" to (
                        200 to """
                        {"items":[${item("LAB", "Tahlil", true, true)}],
                         "missingMandatory":0,"complete":true}
                        """.trimIndent()
                        ),
                ),
            ),
        )

        subject.load()

        assertEquals(listOf("Tahlil"), subject.state.value.done.map { it.label })
        assertTrue(subject.state.value.complete)
        assertTrue(subject.state.value.outstanding.isEmpty())
    }

    /** No list defined is not an empty list of requirements. */
    @Test
    fun `a clinic with no checklist is its own state`() = runTest {
        val subject = model(
            ChecklistTransport(
                mapOf(
                    "me/documents/checklist" to (
                        200 to """{"items":[],"missingMandatory":0,"complete":true}"""
                        ),
                ),
            ),
        )

        subject.load()

        assertEquals(ChecklistPhase.Empty, subject.state.value.phase)
    }

    @Test
    fun `a clinician reads the checklist through the patient path`() = runTest {
        val transport = ChecklistTransport(
            mapOf(
                "patients/p1/documents/checklist" to (
                    200 to """{"items":[${item("LAB", "Tahlil", true, false)}],
                               "missingMandatory":1,"complete":false}"""
                    ),
            ),
        )
        val subject = model(transport, RecordSubject.Patient("p1"))

        subject.load()

        assertEquals(listOf("patients/p1/documents/checklist"), transport.paths)
        assertEquals(1, subject.state.value.missingMandatory)
        assertFalse(subject.state.value.complete)
    }
}

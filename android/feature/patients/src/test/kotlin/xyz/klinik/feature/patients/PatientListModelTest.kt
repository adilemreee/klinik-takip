package xyz.klinik.feature.patients

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.PatientsApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

/**
 * Answers based on the request's query, with a per-query delay, so a test can
 * make an earlier request finish after a later one. Delays run on the test
 * scheduler's virtual clock, so the ordering is deterministic.
 */
private class QueryTransport(
    private val bodies: Map<String, String>,
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val requested = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val query = Regex("[?&]q=([^&]*)").find(request.url)?.groupValues?.get(1) ?: ""
        val cursor = Regex("[?&]cursor=([^&]*)").find(request.url)?.groupValues?.get(1)
        val key = if (cursor != null) "$query|$cursor" else query

        requested += key
        delays[key]?.let { delay(it) }

        return bodies[key]?.let { HttpResponse(200, it) } ?: HttpResponse(500, "{}")
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The list must not refresh")
}

/** The refresh token has been spent or the family revoked: the session is over. */
private object DeadRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        throw ApiError.Unauthorized(xyz.klinik.network.ErrorResponse(statusCode = 401))
}

class PatientListModelTest {
    private fun patient(id: String, surname: String = "Yilmaz") = """
        {"id":"$id","mrn":"2026-AAAAAA","firstName":"Ayse","lastName":"$surname",
         "birthDate":"1985-03-12","sex":"FEMALE","country":"DE","city":null,
         "preferredLanguage":"tr","status":"LEAD","createdAt":"2026-01-01T00:00:00.000Z"}
    """.trimIndent()

    private fun page(ids: List<String>, next: String? = null, surname: String = "Yilmaz"): String {
        val items = ids.joinToString(",") { patient(it, surname) }
        val cursor = next?.let { "\"$it\"" } ?: "null"
        return """{"items":[$items],"nextCursor":$cursor}"""
    }

    private suspend fun model(
        transport: HttpTransport,
        pageSize: Int = 25,
        refresher: TokenRefresher = UnusedRefresher,
    ): PatientListModel {
        val session = SessionManager(InMemoryTokenStore(), refresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)
        return PatientListModel(PatientsApi(client), pageSize)
    }

    @Test
    fun `loads the first page`() = runTest {
        val list = model(QueryTransport(mapOf("" to page(listOf("a", "b")))))

        list.search("")

        assertEquals(ListPhase.Loaded, list.state.value.phase)
        assertEquals(listOf("a", "b"), list.state.value.patients.map { it.id })
        assertFalse(list.state.value.hasMore)
    }

    /**
     * An empty result is not a failure; the screen invites a different search
     * rather than offering a retry button.
     */
    @Test
    fun `reports an empty result as empty rather than failed`() = runTest {
        val list = model(QueryTransport(mapOf("nobody" to page(emptyList()))))

        list.search("nobody")

        assertEquals(ListPhase.Empty, list.state.value.phase)
    }

    @Test
    fun `appends the next page without repeating rows`() = runTest {
        val list = model(
            QueryTransport(
                mapOf(
                    "" to page(listOf("a", "b"), next = "cursor-1"),
                    "|cursor-1" to page(listOf("c", "d")),
                ),
            ),
        )

        list.search("")
        list.loadMore()

        assertEquals(listOf("a", "b", "c", "d"), list.state.value.patients.map { it.id })
        assertFalse(list.state.value.hasMore)
    }

    @Test
    fun `does nothing on load more when the end is reached`() = runTest {
        val transport = QueryTransport(mapOf("" to page(listOf("a"))))
        val list = model(transport)

        list.search("")
        list.loadMore()
        list.loadMore()

        assertEquals(listOf(""), transport.requested)
    }

    /**
     * The race this model exists to avoid.
     *
     * Typing "Zim" then "Zimm" sends two requests, and nothing promises they
     * return in order. Without a guard the slower answer for the shorter query
     * lands last, and the list shows results the user is no longer asking for.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `a slow response for an earlier query does not overwrite a newer one`() = runTest {
        val transport = QueryTransport(
            bodies = mapOf(
                "Zim" to page(listOf("old-1", "old-2"), surname = "Zimmer"),
                "Zimm" to page(listOf("new-1"), surname = "Zimmermann"),
            ),
            delays = mapOf("Zim" to 120L, "Zimm" to 10L),
        )
        val list = model(transport)

        launch { list.search("Zim") }
        advanceTimeBy(20)
        launch { list.search("Zimm") }
        advanceUntilIdle()

        assertEquals("Zimm", list.state.value.query)
        assertEquals(
            listOf("new-1"),
            list.state.value.patients.map { it.id },
            "the list must show the newest query's results, not whichever answer arrived last",
        )
    }

    /**
     * A page arriving after the user started a new search belongs to a list
     * that no longer exists.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `a page arriving after a new search is dropped`() = runTest {
        val transport = QueryTransport(
            bodies = mapOf(
                "" to page(listOf("a"), next = "cursor-1"),
                "|cursor-1" to page(listOf("b")),
                "other" to page(listOf("z")),
            ),
            delays = mapOf("|cursor-1" to 120L),
        )
        val list = model(transport)

        list.search("")
        launch { list.loadMore() }
        advanceTimeBy(20)
        launch { list.search("other") }
        advanceUntilIdle()

        assertEquals(listOf("z"), list.state.value.patients.map { it.id })
    }

    @Test
    fun `shows a message key when offline`() = runTest {
        val list = model(FailingTransport(ApiError.Offline))

        list.search("")

        assertEquals(ListPhase.Failed("error.offline"), list.state.value.phase)
    }

    /**
     * A dead session is not a mistyped password. Telling a nurse mid-shift that
     * her password is wrong sends her to change something that is fine.
     */
    /**
     * A dead session is not a mistyped password. Telling a nurse mid-shift that
     * her password is wrong sends her to change something that is fine.
     *
     * The realistic path: the request comes back 401, the client refreshes, and
     * the refresh is refused too because the chain is over.
     */
    @Test
    fun `reports an expired session as such rather than as wrong credentials`() = runTest {
        val alwaysUnauthorized = object : HttpTransport {
            override suspend fun send(request: HttpRequest) =
                HttpResponse(401, """{"statusCode":401,"message":"Unauthorized"}""")
        }
        val list = model(alwaysUnauthorized, refresher = DeadRefresher)

        list.search("")

        assertEquals(ListPhase.Failed("error.sessionExpired"), list.state.value.phase)
    }

    /**
     * Losing pages already on screen because page three failed would be worse
     * than showing what we have.
     */
    @Test
    fun `keeps loaded pages when a further page fails`() = runTest {
        val transport = QueryTransport(mapOf("" to page(listOf("a", "b"), next = "cursor-1")))
        val list = model(transport)

        list.search("")
        list.loadMore()

        assertEquals(listOf("a", "b"), list.state.value.patients.map { it.id })
        assertFalse(list.state.value.isLoadingMore)
    }

    @Test
    fun `retry repeats the current search`() = runTest {
        val transport = QueryTransport(mapOf("Ayse" to page(listOf("a"))))
        val list = model(transport)

        list.search("Ayse")
        list.retry()

        assertEquals(listOf("Ayse", "Ayse"), transport.requested)
    }
}

class PatientDetailModelTest {
    private class StatusTransport(private val status: Int, private val body: String) : HttpTransport {
        override suspend fun send(request: HttpRequest) = HttpResponse(status, body)
    }

    private suspend fun model(transport: HttpTransport): PatientDetailModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)
        return PatientDetailModel(PatientsApi(client), "p1")
    }

    @Test
    fun `loads the patient`() = runTest {
        val body = """
            {"id":"p1","mrn":"2026-K7RMPX","firstName":"Ayse","lastName":"Yilmaz",
             "birthDate":"1985-03-12","sex":"FEMALE","country":"DE","city":"Berlin",
             "preferredLanguage":"tr","status":"POST_OP","createdAt":"2026-01-01T00:00:00.000Z"}
        """.trimIndent()
        val detail = model(StatusTransport(200, body))

        detail.load()

        val phase = detail.state.value
        assertTrue(phase is DetailPhase.Loaded)
        assertEquals("2026-K7RMPX", phase.patient.mrn)
        assertEquals("Ayse Yilmaz", phase.patient.fullName)
    }

    /**
     * The backend answers 404 both for a record that does not exist and for one
     * outside this user's scope, so an account cannot probe whether a named
     * person is a patient here. The client must not undo that.
     */
    @Test
    fun `treats out of scope as not found without revealing existence`() = runTest {
        val detail = model(StatusTransport(404, "{}"))

        detail.load()

        assertEquals(DetailPhase.NotFound, detail.state.value)
    }

    @Test
    fun `reports other failures with a message key`() = runTest {
        val detail = model(StatusTransport(503, "{}"))

        detail.load()

        assertEquals(DetailPhase.Failed("error.server"), detail.state.value)
    }
}

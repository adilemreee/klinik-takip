package xyz.klinik.network

import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** Records what the client sent and replays scripted responses. */
private class RecordingTransport(responses: List<HttpResponse>) : HttpTransport {
    private val queue = ArrayDeque(responses)
    val requests = mutableListOf<HttpRequest>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        requests += request
        return if (queue.isEmpty()) HttpResponse(500, "{}") else queue.removeFirst()
    }
}

private class StubRefresher : TokenRefresher {
    val callCount = AtomicInteger(0)

    override suspend fun refresh(refreshToken: String): SessionTokens {
        callCount.incrementAndGet()
        return SessionTokens("refreshed-access", "refreshed-refresh", System.currentTimeMillis() + 900_000)
    }
}

class ApiClientTest {
    private val baseUrl = "https://api.example.test"

    private suspend fun client(
        responses: List<HttpResponse>,
        signedIn: Boolean = true,
    ): Triple<ApiClient, RecordingTransport, StubRefresher> {
        val transport = RecordingTransport(responses)
        val refresher = StubRefresher()
        val session = SessionManager(InMemoryTokenStore(), refresher)

        if (signedIn) {
            session.signIn(
                SessionTokens("current-access", "current-refresh", System.currentTimeMillis() + 900_000),
            )
        }

        return Triple(ApiClient(ApiConfiguration(baseUrl), transport, session), transport, refresher)
    }

    @Test
    fun `attaches the bearer token`() = runTest {
        val (api, transport, _) = client(listOf(HttpResponse(200, """{"ok":true}""")))

        api.send(Endpoint(HttpMethod.GET, "patients"))

        assertEquals("Bearer current-access", transport.requests.first().headers["Authorization"])
    }

    /**
     * Sign-in and refresh must not carry a token: attaching an expired one
     * would trigger a refresh in order to call refresh.
     */
    @Test
    fun `sends no token on unauthenticated endpoints`() = runTest {
        val (api, transport, _) = client(listOf(HttpResponse(200, "{}")), signedIn = false)

        api.send(Endpoint(HttpMethod.POST, "auth/login", requiresAuthentication = false))

        assertNull(transport.requests.first().headers["Authorization"])
    }

    @Test
    fun `refreshes once and retries after a 401`() = runTest {
        val (api, transport, refresher) = client(
            listOf(HttpResponse(401, "{}"), HttpResponse(200, """{"ok":true}""")),
        )

        api.send(Endpoint(HttpMethod.GET, "patients"))

        assertEquals(1, refresher.callCount.get())
        assertEquals(2, transport.requests.size)
        assertEquals("Bearer refreshed-access", transport.requests.last().headers["Authorization"])
    }

    /**
     * One retry, no more. Each refresh spends a single-use token, so looping
     * would burn the chain and get the whole device session revoked.
     */
    @Test
    fun `gives up after a second 401 rather than looping`() = runTest {
        val (api, transport, refresher) = client(
            listOf(HttpResponse(401, "{}"), HttpResponse(401, "{}"), HttpResponse(401, "{}")),
        )

        val error = assertFailsWith<ApiError.Unauthorized> {
            api.send(Endpoint(HttpMethod.GET, "patients"))
        }

        assertTrue(error.requiresReauthentication)
        assertEquals(1, refresher.callCount.get())
        assertEquals(2, transport.requests.size)
    }

    @Test
    fun `does not refresh on an unauthenticated endpoint`() = runTest {
        val (api, _, refresher) = client(listOf(HttpResponse(401, "{}")), signedIn = false)

        assertFailsWith<ApiError> {
            api.send(Endpoint(HttpMethod.POST, "auth/login", requiresAuthentication = false))
        }

        assertEquals(0, refresher.callCount.get())
    }

    @Test
    fun `maps the authentication code the backend returns`() = runTest {
        val (api, _, _) = client(
            listOf(HttpResponse(401, """{"statusCode":401,"message":"MFA_REQUIRED"}""")),
            signedIn = false,
        )

        val error = assertFailsWith<ApiError.Auth> {
            api.send(Endpoint(HttpMethod.POST, "auth/login", requiresAuthentication = false))
        }

        assertEquals(AuthErrorCode.MFA_REQUIRED, error.code)
    }

    @Test
    fun `joins a message array into one field`() = runTest {
        val (api, _, _) = client(
            listOf(HttpResponse(400, """{"statusCode":400,"message":["too short","must contain a number"]}""")),
        )

        val error = assertFailsWith<ApiError.Validation> { api.send(Endpoint(HttpMethod.GET, "x")) }

        assertTrue(error.body.message.contains("too short"))
        assertTrue(error.body.message.contains("must contain a number"))
    }

    @Test
    fun `maps status codes to the cases the UI branches on`() = runTest {
        val cases = mapOf(
            403 to ApiError.Forbidden::class,
            404 to ApiError.NotFound::class,
            409 to ApiError.Conflict::class,
            503 to ApiError.Server::class,
        )

        for ((status, expected) in cases) {
            val (api, _, _) = client(listOf(HttpResponse(status, "{}")))
            val error = assertFailsWith<ApiError> { api.send(Endpoint(HttpMethod.GET, "x")) }
            assertEquals(expected, error::class, "status $status")
        }
    }

    @Test
    fun `reads retry-after on rate limiting`() = runTest {
        val (api, _, _) = client(
            listOf(HttpResponse(429, "{}", mapOf("retry-after" to "30"))),
        )

        val error = assertFailsWith<ApiError.RateLimited> { api.send(Endpoint(HttpMethod.GET, "x")) }

        assertEquals(30L, error.retryAfterSeconds)
    }

    @Test
    fun `orders query parameters so requests are reproducible`() = runTest {
        val (api, transport, _) = client(listOf(HttpResponse(200, "{}")))

        api.send(
            Endpoint(HttpMethod.GET, "patients", query = mapOf("limit" to "25", "country" to "DE", "q" to "a")),
        )

        assertTrue(transport.requests.first().url.endsWith("?country=DE&limit=25&q=a"))
    }

    @Test
    fun `sends accept-language so the backend can localise`() = runTest {
        val transport = RecordingTransport(listOf(HttpResponse(200, "{}")))
        val session = SessionManager(InMemoryTokenStore(), StubRefresher())
        val api = ApiClient(ApiConfiguration(baseUrl, preferredLanguage = "de"), transport, session)

        api.send(Endpoint(HttpMethod.GET, "x", requiresAuthentication = false))

        assertEquals("de", transport.requests.first().headers["Accept-Language"])
    }
}

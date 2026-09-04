package xyz.klinik.network

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class HttpTokenRefresherTest {
    private val sent = mutableListOf<HttpRequest>()

    private fun refresher(
        response: HttpResponse,
        baseUrl: String = "https://api.example/",
    ): HttpTokenRefresher = HttpTokenRefresher(
        configuration = ApiConfiguration(baseUrl = baseUrl, preferredLanguage = "tr"),
        transport = { request ->
            sent += request
            response
        },
        now = { 1_000_000L },
    )

    @Test
    fun `exchanges the token and dates the expiry from now`() = runTest {
        val tokens = refresher(
            HttpResponse(
                200,
                """{"accessToken":"a2","refreshToken":"r2","expiresIn":900}""",
            ),
        ).refresh("r1")

        assertEquals("a2", tokens.accessToken)
        assertEquals("r2", tokens.refreshToken)
        // expiresIn is seconds; a client that read it as milliseconds would
        // treat a fifteen-minute token as expiring in under a second and
        // refresh on every request, spending single-use tokens in a loop.
        assertEquals(1_000_000L + 900_000L, tokens.expiresAtMillis)
    }

    @Test
    fun `posts the refresh token to the refresh endpoint without an Authorization header`() = runTest {
        refresher(HttpResponse(200, """{"accessToken":"a","refreshToken":"r","expiresIn":60}"""))
            .refresh("r1")

        val request = sent.single()
        assertEquals("POST", request.method)
        assertEquals("https://api.example/auth/refresh", request.url)
        assertEquals("""{"refreshToken":"r1"}""", request.body)
        // Sending one would make this depend on the very token it exists to
        // replace.
        assertTrue(request.headers.keys.none { it.equals("Authorization", ignoreCase = true) })
    }

    @Test
    fun `does not double the slash when the base URL has one`() = runTest {
        // "https://api.example//auth/refresh" is a different path, and a strict
        // router answers 404 — which the session would read as a dead refresh
        // chain and sign the user out.
        refresher(
            HttpResponse(200, """{"accessToken":"a","refreshToken":"r","expiresIn":60}"""),
            baseUrl = "https://api.example/",
        ).refresh("r1")

        assertEquals("https://api.example/auth/refresh", sent.single().url)
    }

    @Test
    fun `a rejected refresh raises the server's error`() = runTest {
        // The token was already spent, or the family was revoked after a
        // replay. SessionManager turns this into EXPIRED; it must arrive as an
        // ApiError to do so.
        val error = assertFailsWith<ApiError> {
            refresher(HttpResponse(401, """{"statusCode":401,"message":"revoked"}""")).refresh("r1")
        }

        assertTrue(error is ApiError.Unauthorized, "got $error")
    }

    @Test
    fun `a redirect is a failure, not a session`() = runTest {
        // A 30x from the refresh endpoint is a misconfiguration — a proxy, or a
        // base URL pointing at a marketing site. Treating the range as success
        // would turn it into a decoding error and hide what actually went
        // wrong.
        val error = assertFailsWith<ApiError> {
            refresher(HttpResponse(302, "")).refresh("r1")
        }

        assertTrue(error !is ApiError.Decoding, "a redirect was read as a body: $error")
    }

    @Test
    fun `a garbled success body is a decoding failure, not a session`() = runTest {
        // Anything else would hand SessionManager a half-built session and the
        // user would be signed in with no usable token.
        assertFailsWith<ApiError.Decoding> {
            refresher(HttpResponse(200, "<html>gateway</html>")).refresh("r1")
        }
    }

    @Test
    fun `an unparseable error body still fails with the right status`() = runTest {
        // A proxy's HTML error page. The status is what decides the outcome, so
        // it must survive a body that is not JSON at all.
        val error = assertFailsWith<ApiError> {
            refresher(HttpResponse(503, "<html>Service Unavailable</html>")).refresh("r1")
        }

        assertTrue(error is ApiError.Server, "got $error")
    }
}

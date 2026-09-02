package xyz.klinik.feature.lab

import kotlinx.coroutines.delay
import xyz.klinik.network.ApiError
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

/** Replies by method and path, and records what was asked for. */
internal class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
    /**
     * Per-path delay, so the concurrency tests actually overlap. Without one
     * the first call finishes — guard released — before the second starts, and
     * nothing about concurrency is being tested.
     */
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val calls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val key = "${request.method} $path"
        calls += key

        delays[key]?.let { delay(it) }

        val (status, body) = bodies[key] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

/** Replies by path alone, for the read-only screens. */
internal class PathTransport(
    private val bodies: Map<String, Pair<Int, String>>,
) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val (status, body) = bodies[path] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

internal class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

internal object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("These screens must not refresh")
}

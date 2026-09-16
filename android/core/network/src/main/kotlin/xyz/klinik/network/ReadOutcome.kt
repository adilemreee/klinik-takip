package xyz.klinik.network

import kotlinx.coroutines.CancellationException

/**
 * A best-effort read: what came back, or why nothing did.
 *
 * `runCatching { … }.getOrNull()` throws the reason away, and several screens
 * then read "nothing came back from any of these" as "this account may not see
 * the panel". That is true of a 403 and of nothing else — an unreachable
 * clinic, a 500, or a response the app cannot parse would all be reported to a
 * finance officer as a permission problem, on a screen with no way to try
 * again.
 */
sealed interface Attempted<out T> {
    data class Arrived<T>(val result: T) : Attempted<T>
    data class Failed(val reason: ApiError) : Attempted<Nothing>

    val value: T? get() = (this as? Arrived)?.result
    val error: ApiError? get() = (this as? Failed)?.reason
}

/**
 * Runs a read that is allowed to fail, keeping the reason.
 *
 * `CancellationException` is rethrown rather than recorded: a coroutine that
 * was cancelled did not fail, and swallowing it breaks the structured
 * concurrency the caller is relying on — which `runCatching` does silently.
 */
suspend fun <T> attempt(work: suspend () -> T): Attempted<T> =
    try {
        Attempted.Arrived(work())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: ApiError) {
        Attempted.Failed(error)
    } catch (error: Throwable) {
        Attempted.Failed(ApiError.Decoding(error.message ?: "unknown"))
    }

/** What a screen should show when every one of its reads came back empty. */
sealed interface ReadOutcome {
    /** Every failure was a refusal: this account may not see the screen. */
    data object Refused : ReadOutcome

    /** Something else went wrong. Worth saying what, and worth a retry. */
    data class Failed(val message: UiText) : ReadOutcome

    companion object {
        fun of(errors: List<ApiError>): ReadOutcome {
            val reason = errors.firstOrNull { it !is ApiError.Forbidden } ?: return Refused

            return Failed(reason.uiText())
        }
    }
}

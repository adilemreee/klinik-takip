package xyz.klinik.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.klinik.network.ApiError
import xyz.klinik.network.MeApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionState
import xyz.klinik.shell.Root
import xyz.klinik.shell.RootInput
import xyz.klinik.shell.RootRoute

data class RootUiState(
    val input: RootInput = RootInput(session = SessionState.SIGNED_OUT),
    /**
     * Why the launch screen is still up.
     *
     * Without it the app looks frozen when the clinic's server is unreachable,
     * which is precisely when somebody most needs to be told something rather
     * than shown a spinner forever.
     */
    val failure: ApiError? = null,
) {
    val route: RootRoute? get() = Root.route(input)
}

/**
 * Holds the one thing the whole app branches on: who is signed in.
 *
 * The decision itself lives in `core:shell` and is tested there. This carries
 * it across configuration changes and does the asking.
 */
class RootViewModel(
    private val session: SessionManager,
    private val me: MeApi,
) : ViewModel() {
    private val _state = MutableStateFlow(RootUiState())
    val state: StateFlow<RootUiState> = _state.asStateFlow()

    init {
        // Here rather than from an effect in the composition: the view model
        // outlives a rotation and the composition does not, and restoring twice
        // would spend a refresh token for nothing.
        start()
    }

    /**
     * Restores the stored session and asks who it belongs to.
     *
     * Both, in that order, before anything is shown: the launch screen stays up
     * until the answer arrives, because showing sign-in first and replacing it
     * a moment later is a flash of the wrong screen on every single launch.
     */
    private fun start() {
        viewModelScope.launch {
            session.restore()
            _state.value = RootUiState(RootInput(session = session.state))

            if (session.state == SessionState.SIGNED_IN) loadIdentity()
        }
    }

    /** After a successful sign-in, when there is a session but no identity yet. */
    fun onSignedIn() {
        viewModelScope.launch {
            _state.value = RootUiState(RootInput(session = SessionState.SIGNED_IN))
            loadIdentity()
        }
    }

    fun signOut() {
        viewModelScope.launch {
            session.signOut()
            _state.value = RootUiState(RootInput(session = SessionState.SIGNED_OUT))
        }
    }

    fun retry() {
        viewModelScope.launch {
            _state.update { it.copy(failure = null) }
            if (session.state == SessionState.SIGNED_IN) loadIdentity() else start()
        }
    }

    private suspend fun loadIdentity() {
        try {
            val identity = me.identity()
            _state.value = RootUiState(
                RootInput(session = SessionState.SIGNED_IN, identity = identity),
            )
        } catch (error: ApiError) {
            // A refresh that failed already moved the session to EXPIRED; that
            // is the honest state and the screen says so. Anything else — no
            // signal, a 500 — leaves a signed-in session with no identity,
            // which the router holds on the launch screen. The failure is what
            // turns that hold into an explanation and a retry button.
            val current = session.state
            _state.value = RootUiState(
                input = RootInput(session = current),
                failure = if (current == SessionState.SIGNED_IN) error else null,
            )
        }
    }
}

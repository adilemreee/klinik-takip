package xyz.klinik.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.auth.AuthFlowModel
import xyz.klinik.feature.auth.AuthStep
import xyz.klinik.feature.auth.ui.AuthFlowScreen
import xyz.klinik.feature.home.HomeModel
import xyz.klinik.feature.home.ui.HomeScreen
import xyz.klinik.feature.patients.PatientListModel
import xyz.klinik.feature.complications.MyComplicationsModel
import xyz.klinik.feature.complications.ui.MyComplicationsScreen
import xyz.klinik.feature.documents.DocumentsModel
import xyz.klinik.feature.documents.ui.DocumentListScreen
import xyz.klinik.feature.lab.LabTrendModel
import xyz.klinik.feature.lab.ui.LabTrendScreen
import xyz.klinik.feature.measurements.MeasurementsModel
import xyz.klinik.feature.measurements.ui.RecordMeasurementScreen
import xyz.klinik.feature.messaging.ChatModel
import xyz.klinik.feature.messaging.ui.ChatScreen
import xyz.klinik.feature.patients.ui.PatientListScreen
import xyz.klinik.feature.photos.PhotoGalleryModel
import xyz.klinik.feature.photos.ui.PhotoGalleryScreen
import xyz.klinik.network.MeasurementSource
import xyz.klinik.network.MeasurementSubject
import xyz.klinik.network.RecordSubject
import xyz.klinik.network.messageKey
import xyz.klinik.shell.RootRoute
// Design-system resources live in their own R class, not the app's: since AGP
// 8 the R class is non-transitive, so a library's resources are namespaced to
// that library rather than merged into every module that depends on it. Only
// `app_name`, declared here, is in the app's own R.
import xyz.klinik.design.R as DesignR

/**
 * The app's only navigation decision (T2.3–T2.5).
 *
 * Deliberately a `when` over [RootRoute] and not a `NavHost`: there is exactly
 * one branch point, it is taken from a value the server supplied, and it must
 * not be possible to reach the staff list by pushing a route. A back stack is
 * for navigation *within* whichever of these the person is entitled to.
 */
@Composable
fun RootScreen(environment: AppEnvironment, model: RootViewModel) {
    val state by model.state.collectAsStateWithLifecycle()

    when (val route = state.route) {
        // Still asking. Not sign-in: guessing here flashes the login screen at
        // somebody who is already signed in, on every launch.
        null -> LaunchScreen(failureKey = state.failure?.messageKey(), onRetry = model::retry)

        RootRoute.SignIn -> SignInRoute(environment, model, expired = false)
        RootRoute.SignInAgain -> SignInRoute(environment, model, expired = true)

        is RootRoute.PatientHome -> PatientHomeRoute(environment, model)
        is RootRoute.StaffHome -> StaffHomeRoute(environment, model)
        is RootRoute.Unsupported -> UnsupportedRoute(route, model)
    }
}

@Composable
private fun LaunchScreen(failureKey: String?, onRetry: () -> Unit) {
    val context = LocalContext.current

    Centred {
        if (failureKey == null) {
            CircularProgressIndicator()
            Text(
                text = stringResource(DesignR.string.app_starting),
                color = klinikColor("textSecondary"),
                modifier = Modifier.padding(top = 16.dp),
            )
        } else {
            // The server is unreachable and the app would otherwise look
            // frozen. Both the reason and a way out.
            Text(
                text = stringResource(DesignR.string.app_identity_failed),
                color = klinikColor("textPrimary"),
                textAlign = TextAlign.Center,
            )
            Text(
                text = context.stringForKey(failureKey),
                color = klinikColor("textSecondary"),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
            Button(onClick = onRetry, modifier = Modifier.padding(top = 24.dp)) {
                Text(stringResource(DesignR.string.app_retry))
            }
        }
    }
}

@Composable
private fun SignInRoute(environment: AppEnvironment, model: RootViewModel, expired: Boolean) {
    val auth = remember { AuthFlowModel(environment.auth, environment.session) }
    val state by auth.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // The screen reports reaching SignedIn from inside composition, so the
    // handover happens in an effect keyed on the step — once, rather than on
    // every recomposition until the route changes.
    LaunchedEffect(state.step) {
        if (state.step == AuthStep.SignedIn) model.onSignedIn()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        if (expired) {
            // The session lapsed while the app was closed. Saying so is the
            // difference between "you were away a while" and "your account is
            // gone", and only one of those is true.
            Text(
                text = stringResource(DesignR.string.auth_session_expired),
                color = klinikColor("textSecondary"),
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }

        AuthFlowScreen(
            state = state,
            strings = authStrings(state.errorKey),
            onCredentials = { identifier, password ->
                scope.launch { auth.submitCredentials(identifier, password) }
            },
            onCode = { code -> scope.launch { auth.submitTwoFactorCode(code) } },
            onConfirmSetup = { code -> scope.launch { auth.confirmTwoFactorSetup(code) } },
            onSignedIn = { /* handled by the effect above */ },
        )
    }
}

@Composable
private fun PatientHomeRoute(environment: AppEnvironment, model: RootViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    // One level deep, and back returns home. A back stack would be the right
    // answer once these screens push further; today none of them do.
    var destination by remember { mutableStateOf<PatientDestination>(PatientDestination.Home) }

    BackHandler(enabled = destination != PatientDestination.Home) {
        destination = PatientDestination.Home
    }

    if (destination != PatientDestination.Home) {
        Column(modifier = Modifier.fillMaxSize()) {
            TextButton(onClick = { destination = PatientDestination.Home }) {
                Text(stringResource(DesignR.string.common_close))
            }

            PatientDestinationScreen(environment, destination)
        }

        return
    }

    val home: HomeModel = remember { environment.homeModel() }
    // The countdown runs in this scope, so it stops when the screen leaves
    // rather than arming a button nobody is looking at.
    val emergency = remember(scope) { environment.emergencyModel(scope) }
    val homeState by home.state.collectAsStateWithLifecycle()
    val emergencyPhase by emergency.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { home.load() }

    HomeScreen(
        state = homeState,
        emergency = emergencyPhase,
        strings = homeStrings(state.input.identity?.displayName.orEmpty()),
        onSelect = { action ->
            // Emergency confirms in place; medications has no Compose screen
            // on Android yet. Both return null and the tile does nothing,
            // which is the honest outcome until the screen exists.
            destinationFor(action)?.let { destination = it }
        },
        onArmEmergency = { emergency.arm() },
        onConfirmEmergency = { scope.launch { emergency.confirm() } },
        // Backing out before anything is sent.
        onCancelEmergency = emergency::cancel,
        // Closing the outcome after it has been read.
        onAcknowledgeEmergency = emergency::acknowledge,
        onRetry = { scope.launch { home.load() } },
    )
}

@Composable
private fun StaffHomeRoute(environment: AppEnvironment, model: RootViewModel) {
    val patients: PatientListModel = remember { environment.patientListModel() }
    val listState by patients.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // An empty query is the whole list; the screen opens on it.
    LaunchedEffect(Unit) { patients.search("") }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            horizontalAlignment = Alignment.End,
        ) {
            TextButton(onClick = model::signOut) {
                Text(stringResource(DesignR.string.auth_sign_out))
            }
        }

        PatientListScreen(
            state = listState,
            strings = patientStrings(),
            query = listState.query,
            onQueryChange = { text -> scope.launch { patients.search(text) } },
            onSelect = { /* The patient file arrives with T2.6. */ },
            onLoadMore = { scope.launch { patients.loadMore() } },
            onRetry = { scope.launch { patients.retry() } },
        )
    }
}

@Composable
private fun UnsupportedRoute(route: RootRoute.Unsupported, model: RootViewModel) {
    val context = LocalContext.current

    Centred {
        Text(
            text = stringResource(DesignR.string.app_role_unsupported),
            color = klinikColor("textPrimary"),
            textAlign = TextAlign.Center,
        )
        Text(
            text = context.stringForRole(route.role),
            color = klinikColor("textSecondary"),
            modifier = Modifier.padding(top = 8.dp),
        )
        TextButton(onClick = model::signOut, modifier = Modifier.padding(top = 24.dp)) {
            Text(stringResource(DesignR.string.auth_sign_out))
        }
    }
}

@Composable
private fun Centred(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            content()
        }
    }
}

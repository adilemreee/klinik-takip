package xyz.klinik.app

import android.content.Context
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.CoroutineScope
import xyz.klinik.feature.home.EmergencyModel
import xyz.klinik.feature.home.EmergencyTrigger
import xyz.klinik.feature.home.HomeModel
import xyz.klinik.feature.patients.PatientListModel
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.AuthApi
import xyz.klinik.network.ComplicationsApi
import xyz.klinik.network.DocumentsApi
import xyz.klinik.network.LabApi
import xyz.klinik.network.MeasurementsApi
import xyz.klinik.network.MessagingApi
import xyz.klinik.network.PhotosApi
import xyz.klinik.network.ResumableUpload
import xyz.klinik.network.EmergencyApi
import xyz.klinik.network.HttpTokenRefresher
import xyz.klinik.network.JdkHttpTransport
import xyz.klinik.network.MeApi
import xyz.klinik.network.PatientsApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.TokenStore
import xyz.klinik.sync.InMemoryOutboxStore
import xyz.klinik.sync.OutboxStore
import xyz.klinik.sync.store.SqliteOutboxStore
import xyz.klinik.sync.store.SqliteSyncStore
import java.io.File
import java.util.Locale

/**
 * Where the app is assembled.
 *
 * Everything below this line takes its collaborators as parameters and is
 * tested without a device; this class is the one place that knows about
 * `Context`, the filesystem and the build configuration. Keeping it small and
 * dependency-free in the other direction is what has let the models be tested
 * on a laptop all along.
 */
class AppEnvironment(context: Context, baseUrl: String = BuildConfig.API_BASE_URL) {
    private val applicationContext = context.applicationContext

    val tokenStore: TokenStore = KeystoreTokenStore(applicationContext)

    private val transport = JdkHttpTransport()

    private val configuration = ApiConfiguration(
        baseUrl = baseUrl,
        // The backend localises what it returns; the app has Turkish and
        // English, and anything else falls back to Turkish rather than to the
        // backend's own default.
        preferredLanguage = if (Locale.getDefault().language == "en") "en" else "tr",
    )

    /**
     * Refreshing goes straight to the transport, not through [client].
     *
     * The client attaches a valid access token to every request, and obtaining
     * one is what this call is for — routing it through the client is a loop.
     */
    val session: SessionManager =
        SessionManager(tokenStore, HttpTokenRefresher(configuration, transport))

    val client: ApiClient by lazy { ApiClient(configuration, transport, session) }

    val auth: AuthApi by lazy { AuthApi(client) }
    val messaging: MessagingApi by lazy { MessagingApi(client) }
    val documents: DocumentsApi by lazy { DocumentsApi(client) }
    val photos: PhotosApi by lazy { PhotosApi(client) }
    val complications: ComplicationsApi by lazy { ComplicationsApi(client) }
    val lab: LabApi by lazy { LabApi(client) }
    val measurements: MeasurementsApi by lazy { MeasurementsApi(client) }

    /** Chunked upload, shared by every screen that can attach a file. */
    val resumable: ResumableUpload by lazy { ResumableUpload(client) }
    val me: MeApi by lazy { MeApi(client) }
    val patients: PatientsApi by lazy { PatientsApi(client) }
    val emergency: EmergencyApi by lazy { EmergencyApi(client) }

    fun homeModel(): HomeModel = HomeModel(me)
    fun patientListModel(): PatientListModel = PatientListModel(patients)

    /**
     * The emergency button's two-step confirmation, over the real endpoint.
     *
     * The model takes a port rather than the API so the confirmation behaviour
     * is tested without a network. This is the adapter, and the location is
     * deliberately not waited for: spec M8 says the alarm goes now and the
     * position follows.
     */
    fun emergencyModel(scope: CoroutineScope): EmergencyModel = EmergencyModel(
        trigger = EmergencyTrigger { note -> emergency.trigger(note = note) },
        scope = scope,
    )

    /**
     * The offline queue, and what happens when it cannot be opened.
     *
     * A device with no writable storage left, or a database file corrupted by a
     * crash mid-write, must not stop the app from starting: a patient who
     * cannot open the app cannot press the emergency button either. It falls
     * back to memory, and [storeFailure] says so, so the app can tell the user
     * that what they enter today will not survive being closed rather than
     * quietly losing it.
     */
    var storeFailure: Throwable? = null
        private set

    val outbox: OutboxStore by lazy {
        try {
            SqliteOutboxStore(
                SqliteSyncStore(
                    driver = BundledSQLiteDriver(),
                    path = File(applicationContext.filesDir, "klinik-sync.db").absolutePath,
                ),
            )
        } catch (error: Throwable) {
            storeFailure = error
            InMemoryOutboxStore()
        }
    }
}

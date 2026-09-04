import Foundation
import KlinikAPI
import KlinikCore
import KlinikHomeFeature
import KlinikSync
import KlinikSyncStore

/**
 * The object graph, built once (T2.3).
 *
 * A composition root rather than singletons reached for from inside screens:
 * every screen in this app already takes what it needs as an argument, which
 * is what made them all testable, and that only holds while something assembles
 * them from outside.
 */
@MainActor
public final class AppEnvironment {
    public let configuration: APIConfiguration
    public let session: SessionManager
    public let client: APIClient

    public let auth: AuthAPI
    public let me: MeAPI
    public let patients: PatientsAPI
    public let emergency: EmergencyAPI

    /// The offline queue's home on disk. Nil only if the file cannot be opened,
    /// which is reported rather than papered over — see `storeFailure`.
    public let outbox: OutboxStore
    public let uploads: UploadStore
    public let storeFailure: String?

    public init(baseURL: URL, preferredLanguage: String = "tr") {
        configuration = APIConfiguration(baseURL: baseURL, preferredLanguage: preferredLanguage)

        let transport = URLSessionTransport()
        session = SessionManager(
            store: KeychainTokenStore(),
            refresher: HTTPTokenRefresher(baseURL: baseURL, transport: transport)
        )

        client = APIClient(configuration: configuration, transport: transport, session: session)

        auth = AuthAPI(client: client)
        me = MeAPI(client: client)
        patients = PatientsAPI(client: client)
        emergency = EmergencyAPI(client: client)

        // A queue that cannot be opened must not take the app down with it:
        // everything still works online, and the failure is surfaced rather
        // than swallowed, because silently losing offline edits is the exact
        // thing the persistent store was built to stop.
        do {
            let store = try SQLiteStore(url: try SQLiteStore.defaultURL())
            outbox = SQLiteOutboxStore(store: store)
            uploads = SQLiteUploadStore(store: store)
            storeFailure = nil
        } catch {
            outbox = InMemoryOutboxStore()
            uploads = InMemoryUploadStore()
            storeFailure = String(describing: error)
        }
    }
}

/**
 * The emergency button's way to reach the server.
 *
 * An adapter rather than handing the API to the model, because the model's
 * whole design is that it does not know what triggering means — which is what
 * lets its two-step confirmation be tested without a network.
 */
public struct APIEmergencyTrigger: EmergencyTrigger {
    private let api: EmergencyAPI

    public init(api: EmergencyAPI) {
        self.api = api
    }

    public func trigger(note: String?) async throws {
        // Location is deliberately not waited for here: spec M8 says the alarm
        // goes now and the position follows.
        _ = try await api.trigger(note: note)
    }
}

import SwiftUI
import KlinikApp

/**
 * The application itself (T2.3).
 *
 * Deliberately almost empty. Everything an app target contains is code that
 * cannot be run from the command line, so the shell — the object graph and the
 * routing — lives in the `KlinikApp` library where it is tested, and this file
 * does the one thing only an app target can: exist.
 */
@main
struct KlinikMain: App {
    /// Where this build talks to. Baked in per configuration rather than typed
    /// by a user: a clinic app that can be pointed at another server is a
    /// phishing surface.
    private static var baseURL: URL {
        #if DEBUG
        // Development only. A release build cannot be pointed anywhere: an app
        // that takes its server from the outside is a phishing surface, and
        // this is the kind of build that is handed to a clinic.
        if let override = UserDefaults.standard.string(forKey: "KlinikAPIBaseURL"),
           let url = URL(string: override) {
            return url
        }
        #endif

        let configured = Bundle.main.object(forInfoDictionaryKey: "KlinikAPIBaseURL") as? String

        guard let configured, let url = URL(string: configured) else {
            // A build with no server configured must fail loudly at launch
            // rather than quietly point at nothing.
            fatalError("KlinikAPIBaseURL is missing from Info.plist")
        }

        // The placeholder from Config/Base.xcconfig. It never resolves, so the
        // app would launch and then fail every request with a network error —
        // which reads as "the clinic is down" rather than "this build was never
        // configured". Saying so here, once, is the difference.
        guard url.host()?.hasSuffix(".invalid") != true else {
            fatalError(
                "KlinikAPIBaseURL is still the placeholder. Copy "
                    + "ios/Config/Local.xcconfig.example to Local.xcconfig and set the host."
            )
        }

        return url
    }

    @State private var environment = AppEnvironment(baseURL: KlinikMain.baseURL)

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
        }
    }
}

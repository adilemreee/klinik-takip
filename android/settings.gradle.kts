pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    // Downloads the JDK the build asks for instead of depending on whatever the
    // machine happens to have installed. Android targets Java 17; the host here
    // has 26, and CI may have something else again.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "klinik"

// Pure Kotlin/JVM. The session, networking and error handling carry no Android
// dependency, so they build and test without the SDK — the same reason the iOS
// client is a Swift package rather than an Xcode project.
include(":core:network")

// Offline queue and synchronisation (spec M15).
include(":core:sync")

// The queue on disk. Plain JVM, because the SQLite driver it uses is
// multiplatform: the same module builds here and runs on the device.
include(":core:sync-store")

// What the app shows and to whom. Plain JVM so the routing decision is tested
// on a laptop rather than on a device.
include(":core:shell")

// Sign-in and onboarding. The flow model holds no Android types, so the branch
// only staff without a second factor ever reach is testable without a device.
include(":feature:auth")

// The staff-side patient list and file.
include(":feature:patients")

// The patient's own home screen.
include(":feature:home")

// Turning readings into chart coordinates. Shared, because measurements and
// lab results draw the same shapes and a second copy would drift.
include(":core:charts")

// Body measurements and the charts drawn from them (spec M2).
include(":feature:measurements")

// Document upload and the queue's progress (spec M2, T3.2).
include(":feature:documents")

// Reviewing what OCR read, before any of it is clinical (spec M16).
include(":feature:lab")

// Before/after photographs and their comparison (spec M7).
include(":feature:photos")

// Complications a patient reports themselves (spec M7).
include(":feature:complications")

// Patient ↔ clinic messaging, with the access window (spec M3).
include(":feature:messaging")

// Notification preferences and the delivery log (spec M6).
include(":feature:notifications")

// The check-up calendar generated from the operation date (spec M6).
include(":feature:followup")

// Appointments and the request/approval flow (spec M10).
include(":feature:appointments")
include(":feature:emergency")

// The Compose modules need the Android SDK. Including them unconditionally
// would make the whole build unusable on a machine without it, so they are
// added only when one is available. CI always has it, so they are always built
// there; nothing is silently skipped where it matters.
val androidSdkAvailable = System.getenv("ANDROID_HOME") != null ||
    System.getenv("ANDROID_SDK_ROOT") != null ||
    file("local.properties").let { it.exists() && it.readText().contains("sdk.dir") }

if (androidSdkAvailable) {
    include(":core:design")
    include(":feature:auth-ui")
    include(":feature:patients-ui")
    include(":feature:home-ui")
    include(":feature:measurements-ui")
    include(":feature:documents-ui")
    include(":feature:lab-ui")
    include(":feature:photos-ui")
    include(":feature:complications-ui")
    include(":feature:messaging-ui")

    // The installable app. Last, because it depends on all of them.
    include(":app")
} else {
    logger.lifecycle("Android SDK not found — building JVM modules only (:core:network).")
}

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

// Sign-in and onboarding. The flow model holds no Android types, so the branch
// only staff without a second factor ever reach is testable without a device.
include(":feature:auth")

// The staff-side patient list and file.
include(":feature:patients")

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
} else {
    logger.lifecycle("Android SDK not found — building JVM modules only (:core:network).")
}

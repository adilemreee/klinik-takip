import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * Where the app talks to.
 *
 * This repository is public, so the clinic's own hostnames are not in it. The
 * value comes from `local.properties` (untracked) or `-PklinikApiBaseUrl=…`,
 * and the real hosts are recorded in docs/OPERASYON-LOCAL.md.
 *
 * The fallback is a name reserved by RFC 2606 that never resolves, so a build
 * that was never told where to talk fails visibly on its first request rather
 * than silently reaching whatever happens to answer.
 */
fun apiBaseUrl(key: String): String {
    (project.findProperty("klinikApiBaseUrl") as String?)?.let { return it }

    val local = rootProject.file("local.properties")
    if (local.exists()) {
        val properties = Properties().apply { local.inputStream().use { load(it) } }
        properties.getProperty(key)?.let { return it }
    }

    return "https://api.invalid"
}

android {
    namespace = "xyz.klinik.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "xyz.klinik.app"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    androidResources {
        // The app ships in Turkish and English and nothing else (T2.1).
        // Without this, every language AndroidX happens to translate is
        // advertised on the store listing and offered in the system language
        // picker — promising a Turkish clinic app in languages nobody here can
        // support.
        localeFilters.addAll(listOf("tr", "en"))
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl("klinik.apiBaseUrl.debug")}\"")
            // So a debug build can sit beside a release one on the same phone —
            // a tester comparing them should not have to uninstall either.
            applicationIdSuffix = ".debug"
        }

        release {
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl("klinik.apiBaseUrl.release")}\"")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Not signed here. A release keystore in the repository is a signing key
    // published to everyone who can clone it.
    lint {
        abortOnError = true
    }
}

dependencies {
    implementation(project(":core:shell"))
    implementation(project(":core:design"))
    implementation(project(":core:sync"))
    implementation(project(":core:sync-store"))

    implementation(project(":feature:auth-ui"))
    implementation(project(":feature:patients-ui"))
    implementation(project(":feature:home-ui"))
    implementation(project(":feature:messaging-ui"))
    implementation(project(":feature:documents-ui"))
    implementation(project(":feature:photos-ui"))
    implementation(project(":feature:complications-ui"))
    implementation(project(":feature:lab-ui"))
    implementation(project(":feature:measurements-ui"))
    implementation(project(":feature:medications-ui"))
    implementation(project(":feature:followup-ui"))
    implementation(project(":feature:appointments-ui"))
    implementation(project(":feature:notifications-ui"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)

    // The queue's SQLite driver. core:sync-store keeps it as an implementation
    // detail, which is right — but the app is the one place that has to name a
    // driver, because it is the one place that knows where the file goes.
    implementation(libs.androidx.sqlite.bundled)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    testImplementation(kotlin("test"))
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

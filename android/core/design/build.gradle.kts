plugins {
    // AGP 9 has Kotlin support built in; applying org.jetbrains.kotlin.android
    // alongside it is an error rather than a redundancy.
    id("com.android.library")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "xyz.klinik.design"
    // The current Compose libraries require 37; the compile SDK is independent
    // of minSdk, so this does not narrow the devices the app runs on.
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
}

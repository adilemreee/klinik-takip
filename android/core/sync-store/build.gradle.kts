plugins {
    id("org.jetbrains.kotlin.jvm")
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    api(project(":core:sync"))
    implementation(libs.kotlinx.coroutines.core)

    // androidx.sqlite is a Kotlin Multiplatform library: the same driver API
    // resolves to a JVM variant here and to an Android one in the app. The
    // bundled driver carries its own SQLite for both, so the queue behaves the
    // same on a test runner as on a five-year-old phone whose system SQLite is
    // whatever the manufacturer shipped.
    api(libs.androidx.sqlite)
    implementation(libs.androidx.sqlite.bundled)

    testImplementation(kotlin("test"))
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test {
    useJUnitPlatform()
}

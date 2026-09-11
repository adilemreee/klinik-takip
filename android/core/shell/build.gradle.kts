import org.gradle.api.tasks.PathSensitivity

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
    api(project(":core:network"))

    // Walks the sealed hierarchy so a destination added without a way in
    // fails a test rather than existing unreachably.
    testImplementation(kotlin("reflect"))
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()

    /*
     * Three tests here read files from other modules — the app's navigation,
     * the design catalogue — to check that a screen has a way in and a name.
     * Gradle cannot see those as inputs on its own, so it called this task
     * up to date after a change to exactly the files being checked, and the
     * check silently did not run. A test that only runs in CI is a test
     * nobody runs before pushing, which is the reason this module exists.
     */
    inputs.files(
        rootProject.layout.projectDirectory.file(
            "app/src/main/kotlin/xyz/klinik/app/PatientNavigation.kt",
        ),
        rootProject.layout.projectDirectory.file(
            "app/src/main/kotlin/xyz/klinik/app/FeatureStrings.kt",
        ),
        rootProject.layout.projectDirectory.file(
            "app/src/main/kotlin/xyz/klinik/app/RootScreen.kt",
        ),
    ).withPropertyName("appSourcesUnderTest").withPathSensitivity(PathSensitivity.RELATIVE)

    inputs.dir(
        rootProject.layout.projectDirectory.dir("core/design/src/main"),
    ).withPropertyName("designCatalogue").withPathSensitivity(PathSensitivity.RELATIVE)
}

/**
 * Plugin versions are declared once here and applied without a version in the
 * modules.
 *
 * Gradle resolves a plugin version at most once per build: as soon as one
 * module puts the Kotlin plugin on the classpath, another asking for it *with*
 * a version fails with "already on the classpath with an unknown version".
 * Declaring them here — applied to nothing — settles the versions up front.
 */
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.compose.compiler) apply false
}

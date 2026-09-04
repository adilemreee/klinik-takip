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

    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}

package xyz.klinik.app

import android.app.Application

class KlinikApplication : Application() {
    /**
     * Built once and shared. Not a dependency-injection framework: the graph is
     * a dozen objects and the wiring is [AppEnvironment], which is easier to
     * read than the annotations that would replace it.
     */
    val environment: AppEnvironment by lazy { AppEnvironment(this) }
}

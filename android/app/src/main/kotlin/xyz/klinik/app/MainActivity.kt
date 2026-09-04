package xyz.klinik.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import xyz.klinik.design.klinikColor

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val environment = (application as KlinikApplication).environment

        setContent {
            val model: RootViewModel = viewModel(
                factory = remember {
                    object : ViewModelProvider.Factory {
                        @Suppress("UNCHECKED_CAST")
                        override fun <T : ViewModel> create(modelClass: Class<T>): T =
                            RootViewModel(environment.session, environment.me) as T
                    }
                },
            )

            Surface(
                color = klinikColor("background"),
                modifier = Modifier.fillMaxSize(),
            ) {
                // Edge-to-edge draws under the status and navigation bars; this
                // keeps content out from under them without giving up the
                // background that reaches the screen edges.
                Surface(
                    color = klinikColor("background"),
                    modifier = Modifier
                        .fillMaxSize()
                        .windowInsetsPadding(WindowInsets.safeDrawing),
                ) {
                    RootScreen(environment, model)
                }
            }
        }
    }
}

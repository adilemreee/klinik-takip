package xyz.klinik.feature.patients.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.patients.InviteProblem
import xyz.klinik.feature.patients.InviteState
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class InviteStrings(
    val title: String,
    val hint: String,
    val email: String,
    val phone: String,
    val action: String,
    val issued: String,
    val shownOnce: String,
    val share: String,
    val expires: String,
    val close: String,
    val problem: (InviteProblem) -> String,
    val message: (UiText) -> String,
)

/**
 * Inviting a patient into the app (spec T7.3).
 *
 * The clinic delivers the code by whatever channel it already uses to talk to
 * this person, so the code is put in front of a coordinator and stays there
 * until they say they have passed it on. The server returns it once and keeps
 * only its hash — a code scrolled away by a refresh is a patient who cannot
 * sign in, and a second invitation to explain.
 */
@Composable
fun InviteScreen(
    state: InviteState,
    strings: InviteStrings,
    patientName: String,
    onEdit: (email: String, phone: String) -> Unit,
    onInvite: () -> Unit,
    onShare: (String) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
        ) {
            Text(
                strings.title,
                fontSize = Tokens.Typography.heading.size,
                fontWeight = Tokens.Typography.heading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            Text(patientName, color = klinikColor("textSecondary"))

            val issued = state.issued

            if (issued != null) {
                Surface(color = klinikColor("successSurface"), modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(Tokens.Spacing.lg),
                        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                    ) {
                        Text(strings.issued, color = klinikColor("success"))

                        Text(
                            issued.code,
                            fontSize = Tokens.Typography.title.size,
                            fontWeight = Tokens.Typography.title.weight,
                            color = klinikColor("textPrimary"),
                        )

                        Text(
                            "${strings.expires}: ${issued.expiresAt.take(10)}",
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                        )

                        // Said beside the code, not before it: this is the
                        // moment somebody decides whether to write it down.
                        Text(strings.shownOnce, color = klinikColor("warning"))

                        Button(
                            onClick = { onShare(issued.code) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text(strings.share)
                        }

                        TextButton(
                            onClick = onDismiss,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text(strings.close)
                        }
                    }
                }

                return@Column
            }

            Text(strings.hint, color = klinikColor("textSecondary"))

            state.error?.let {
                Text(strings.message(it), color = klinikColor("critical"))
            }

            OutlinedTextField(
                value = state.email,
                onValueChange = { onEdit(it, state.phone) },
                label = { Text(strings.email) },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = state.phone,
                onValueChange = { onEdit(state.email, it) },
                label = { Text(strings.phone) },
                modifier = Modifier.fillMaxWidth(),
            )

            state.problems.forEach { problem ->
                Text(
                    strings.problem(problem),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("warning"),
                )
            }

            OutlinedButton(
                onClick = onInvite,
                enabled = state.canSubmit,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.action)
            }
        }
    }
}

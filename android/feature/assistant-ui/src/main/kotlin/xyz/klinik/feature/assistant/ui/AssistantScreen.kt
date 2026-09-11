package xyz.klinik.feature.assistant.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.MarkdownText
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.assistant.AssistantPhase
import xyz.klinik.feature.assistant.AssistantState
import xyz.klinik.feature.assistant.AssistantTurn
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class AssistantStrings(
    val title: String,
    val intro: String,
    val placeholder: String,
    val send: String,
    val disclaimer: String,
    val handover: String,
    val notEnough: String,
    val sent: String,
    val sourcePrefix: String,
    val openConversation: String,
    val message: (UiText) -> String,
)

/**
 * The FAQ assistant (spec M4).
 *
 * Three things on this screen are not decoration. The intro says up front what
 * this is and what it will not do, because a patient who believes they are
 * talking to their doctor will ask it something that needs one. The disclaimer
 * sits under every answer for the same reason. And the way through to a person
 * is always visible — under answers as "this is not enough", and at the bottom
 * as a way to skip the assistant entirely. An assistant that is easier to reach
 * than the clinic is one that delays care.
 */
@Composable
fun AssistantScreen(
    state: AssistantState,
    strings: AssistantStrings,
    onAsk: (String) -> Unit,
    onEscalate: (String) -> Unit,
    onOpenConversation: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var question by remember { mutableStateOf("") }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
            ) {
                Text(
                    strings.title,
                    fontSize = Tokens.Typography.heading.size,
                    fontWeight = Tokens.Typography.heading.weight,
                    color = klinikColor("textPrimary"),
                    modifier = Modifier.semantics { heading() },
                )

                // What this is, and what it will not do — before the first
                // question rather than after a disappointing answer.
                Text(
                    strings.intro,
                    fontSize = Tokens.Typography.callout.size,
                    color = klinikColor("textSecondary"),
                )

                (state.phase as? AssistantPhase.Failed)?.let { failed ->
                    Text(strings.message(failed.message), color = klinikColor("critical"))
                }

                state.turns.forEach { turn ->
                    TurnView(
                        turn = turn,
                        strings = strings,
                        escalating = state.escalatingId == turn.id,
                        onEscalate = onEscalate,
                    )
                }

                // Always available, not only after the assistant disappoints.
                TextButton(onClick = onOpenConversation) { Text(strings.openConversation) }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Tokens.Spacing.lg),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = question,
                    onValueChange = { question = it },
                    label = { Text(strings.placeholder) },
                    enabled = state.phase != AssistantPhase.Asking,
                    modifier = Modifier.weight(1f),
                )

                Button(
                    onClick = {
                        onAsk(question)
                        question = ""
                    },
                    enabled = question.isNotBlank() && state.phase != AssistantPhase.Asking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.send)
                }
            }
        }
    }
}

@Composable
private fun TurnView(
    turn: AssistantTurn,
    strings: AssistantStrings,
    escalating: Boolean,
    onEscalate: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
    ) {
        Surface(color = klinikColor("infoSurface"), modifier = Modifier.fillMaxWidth()) {
            Text(
                turn.question,
                color = klinikColor("textPrimary"),
                modifier = Modifier.padding(Tokens.Spacing.md),
            )
        }

        when {
            turn.isPending -> CircularProgressIndicator()

            // The ask never left the phone. Not a handover: nobody has this
            // question, and saying otherwise would leave a patient waiting.
            turn.failure != null -> Text(
                strings.message(turn.failure!!),
                color = klinikColor("critical"),
            )

            turn.isAnswered -> {
                MarkdownText(turn.result?.answer.orEmpty())

                val sources = turn.result?.sources.orEmpty()

                if (sources.isNotEmpty()) {
                    // Which clinic document this came out of. An answer with no
                    // source behind it is the kind this assistant does not give.
                    Text(
                        "${strings.sourcePrefix}: ${sources.joinToString(", ")}",
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                }

                Text(
                    strings.disclaimer,
                    fontSize = Tokens.Typography.footnote.size,
                    color = klinikColor("textSecondary"),
                )

                if (turn.canEscalate) {
                    TextButton(
                        onClick = { onEscalate(turn.id) },
                        enabled = !escalating,
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.notEnough)
                    }
                } else {
                    Text(strings.sent, color = klinikColor("success"))
                }
            }

            // The server declined to answer and sent it to a person. One
            // message for every reason it declined: a patient needs to know
            // somebody is reading it, not which internal check fired.
            else -> Text(strings.handover, color = klinikColor("textPrimary"))
        }
    }
}

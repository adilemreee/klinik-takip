package xyz.klinik.feature.surveys.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.surveys.SurveyPhase
import xyz.klinik.feature.surveys.SurveyState
import xyz.klinik.network.PendingSurvey
import xyz.klinik.network.SurveyAnswer
import xyz.klinik.network.SurveyAnswerType
import xyz.klinik.network.SurveyDirection
import xyz.klinik.network.SurveyQuestion
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class SurveyStrings(
    val title: String,
    val nothingPending: String,
    val thanks: String,
    val closed: String,
    val submit: String,
    val retry: String,
    val patientNote: String,
    val textPlaceholder: String,
    val yes: String,
    val no: String,
    val none: String,
    val best: String,
    val worst: String,
    /** "Ameliyattan {days} gün sonra", with the number already in it. */
    val milestone: (Int) -> String,
    val message: (UiText) -> String,
)

/**
 * The short questionnaire a patient fills in after surgery (spec M18).
 *
 * One form at a time, sent whole. Nothing on this screen reads the answers
 * back: the server computes findings for the clinic, and "your reported pain
 * has worsened" is a clinical reading that a questionnaire should not be the
 * thing to deliver.
 */
@Composable
fun SurveyScreen(
    state: SurveyState,
    strings: SurveyStrings,
    onAnswer: (String, SurveyAnswer) -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            SurveyPhase.Loading -> Centered { CircularProgressIndicator() }

            is SurveyPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(phase.message), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            // Nothing to fill in — and whether that is because it was just
            // sent or because there was never anything is a different
            // sentence.
            SurveyPhase.None -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        if (state.submitted) strings.thanks else strings.nothingPending,
                        color = klinikColor("textSecondary"),
                        textAlign = TextAlign.Center,
                    )

                    MissedList(state, strings)
                }
            }

            SurveyPhase.Loaded -> state.current?.let { survey ->
                Form(survey, state, strings, onAnswer, onSubmit)
            }
        }
    }
}

@Composable
private fun MissedList(state: SurveyState, strings: SurveyStrings) {
    // Told, rather than hidden: somebody opening the app a week after the
    // reminder should know they missed it, not wonder whether it was asked.
    state.missed.forEach { survey ->
        Text(
            "${strings.milestone(survey.milestoneDays)} — ${strings.closed}",
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
            modifier = Modifier.padding(top = Tokens.Spacing.md),
        )
    }
}

@Composable
private fun Form(
    survey: PendingSurvey,
    state: SurveyState,
    strings: SurveyStrings,
    onAnswer: (String, SurveyAnswer) -> Unit,
    onSubmit: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
    ) {
        Text(
            survey.title,
            fontSize = Tokens.Typography.heading.size,
            fontWeight = Tokens.Typography.heading.weight,
            color = klinikColor("textPrimary"),
            modifier = Modifier.semantics { heading() },
        )

        Text(
            strings.milestone(survey.milestoneDays),
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        survey.description?.let {
            Text(it, color = klinikColor("textSecondary"))
        }

        survey.questions.forEach { question ->
            QuestionCard(
                question = question,
                answer = state.answers[question.id],
                strings = strings,
                onAnswer = { onAnswer(question.id, it) },
            )
        }

        state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

        // Before the button, not after: somebody should know where their
        // answers go before they give them.
        Text(
            strings.patientNote,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        Button(
            onClick = onSubmit,
            enabled = state.canSubmit && !state.submitting,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.submit)
        }

        MissedList(state, strings)
    }
}

/** One question, in the shape its type needs. */
@Composable
private fun QuestionCard(
    question: SurveyQuestion,
    answer: SurveyAnswer?,
    strings: SurveyStrings,
    onAnswer: (SurveyAnswer) -> Unit,
) {
    Surface(color = klinikColor("surface"), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
        ) {
            Text(
                question.text,
                fontSize = Tokens.Typography.subheading.size,
                fontWeight = Tokens.Typography.subheading.weight,
                color = klinikColor("textPrimary"),
            )

            when (question.type) {
                SurveyAnswerType.SCALE_0_10 -> Scale(question, answer, strings, onAnswer)

                SurveyAnswerType.YES_NO -> Row(
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                ) {
                    listOf(true to strings.yes, false to strings.no).forEach { (value, label) ->
                        val chosen = (answer as? SurveyAnswer.YesNo)?.value == value

                        Choice(
                            label = label,
                            chosen = chosen,
                            onClick = { onAnswer(SurveyAnswer.YesNo(value)) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                SurveyAnswerType.TEXT -> OutlinedTextField(
                    value = (answer as? SurveyAnswer.Text)?.value.orEmpty(),
                    onValueChange = { onAnswer(SurveyAnswer.Text(it)) },
                    label = { Text(strings.textPlaceholder) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/**
 * Eleven buttons rather than a slider.
 *
 * A slider needs a steady hand and says nothing about which value is chosen
 * until it is released. Numbered buttons can be hit by somebody on painkillers,
 * read by a screen reader, and answered by touching the number they would have
 * said out loud.
 */
@Composable
private fun Scale(
    question: SurveyQuestion,
    answer: SurveyAnswer?,
    strings: SurveyStrings,
    onAnswer: (SurveyAnswer) -> Unit,
) {
    val chosen = (answer as? SurveyAnswer.Scale)?.value

    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
        listOf(0..5, 6..10).forEach { range ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
                range.forEach { value ->
                    Choice(
                        label = value.toString(),
                        chosen = chosen == value,
                        onClick = { onAnswer(SurveyAnswer.Scale(value)) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // Which end is which, in words. A bare 0–10 row means nothing without
        // knowing whether ten is the good end.
        val higherIsBetter = question.direction == SurveyDirection.HIGHER_IS_BETTER

        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                if (higherIsBetter) strings.worst else strings.none,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
                modifier = Modifier.weight(1f),
            )
            Text(
                if (higherIsBetter) strings.best else strings.worst,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
                textAlign = TextAlign.End,
            )
        }
    }
}

@Composable
private fun Choice(
    label: String,
    chosen: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Selection is announced as well as coloured: a value a reader can only
    // tell by hue is no answer at all (spec section 7).
    val content = if (chosen) klinikColor("accentText") else klinikColor("textPrimary")

    OutlinedButton(
        onClick = onClick,
        modifier = modifier
            .heightIn(min = Tokens.minimumTouchTarget)
            .clip(RoundedCornerShape(Tokens.Radius.md))
            .background(if (chosen) klinikColor("accent") else klinikColor("background"))
            .semantics { selected = chosen },
    ) {
        Text(label, color = content)
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}

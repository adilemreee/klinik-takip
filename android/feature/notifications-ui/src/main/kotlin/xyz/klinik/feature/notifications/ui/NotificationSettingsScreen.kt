package xyz.klinik.feature.notifications.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.notifications.NotificationSettingsState
import xyz.klinik.feature.notifications.SettingsPhase
import xyz.klinik.network.DeliveredNotification
import xyz.klinik.network.NotificationChannel
import xyz.klinik.network.NotificationDeliveryStatus
import xyz.klinik.network.NotificationKind
import xyz.klinik.network.UiText

data class NotificationStrings(
    val title: String,
    val retry: String,
    val fallbackNote: String,
    val quietHours: String,
    val historyTitle: String,
    val historyEmpty: String,
    val historyFallback: String,
    val kindName: (NotificationKind) -> String,
    val channelName: (NotificationChannel) -> String,
    val statusName: (NotificationDeliveryStatus) -> String,
    val message: (UiText) -> String,
)

/**
 * Notification preferences and what was actually delivered (spec M6).
 *
 * `IN_APP` is deliberately not switchable: it is the app's own list, it costs
 * nothing, and silencing the record of what the clinic sent would leave
 * somebody with no way to find out what they missed.
 */
private val SWITCHABLE = listOf(
    NotificationChannel.PUSH,
    NotificationChannel.SMS,
    NotificationChannel.EMAIL,
    NotificationChannel.WHATSAPP,
)

@Composable
fun NotificationSettingsScreen(
    state: NotificationSettingsState,
    strings: NotificationStrings,
    onRetry: () -> Unit,
    onToggle: (NotificationKind, NotificationChannel, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            SettingsPhase.Loading -> Centered { CircularProgressIndicator() }

            is SettingsPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(UiText.Key(phase.messageKey)))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            SettingsPhase.Loaded -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
            ) {
                state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

                // Says plainly that turning a channel off is not silence: the
                // server falls back to another one for anything clinical.
                Text(strings.fallbackNote, color = klinikColor("textSecondary"))

                for (kind in NotificationKind.entries) {
                    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
                        Text(
                            strings.kindName(kind),
                            color = klinikColor("textPrimary"),
                            modifier = Modifier.semantics { heading() },
                        )

                        for (channel in SWITCHABLE) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = Tokens.minimumTouchTarget),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    strings.channelName(channel),
                                    color = klinikColor("textPrimary"),
                                    modifier = Modifier.weight(1f),
                                )

                                Switch(
                                    checked = state.isEnabled(kind, channel),
                                    onCheckedChange = { on -> onToggle(kind, channel, on) },
                                    enabled = state.saving == null,
                                )
                            }
                        }

                        state.quietHours(kind)?.let { (start, end) ->
                            Text(
                                "${strings.quietHours}: $start–$end",
                                color = klinikColor("textSecondary"),
                            )
                        }
                    }
                }

                HorizontalDivider()

                Text(
                    strings.historyTitle,
                    color = klinikColor("textPrimary"),
                    modifier = Modifier.semantics { heading() },
                )

                if (state.history.isEmpty()) {
                    Text(strings.historyEmpty, color = klinikColor("textSecondary"))
                } else {
                    for (delivery in state.history) {
                        DeliveryRow(delivery, strings)
                    }
                }
            }
        }
    }
}

/**
 * One delivery attempt, with the reason it failed if it did.
 *
 * A notification that silently failed is how somebody misses a check-up and
 * believes nobody told them — which, on this screen, they can now check.
 */
@Composable
private fun DeliveryRow(delivery: DeliveredNotification, strings: NotificationStrings) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                delivery.title,
                color = klinikColor("textPrimary"),
                modifier = Modifier.weight(1f),
            )

            Text(strings.statusName(delivery.status), color = tintFor(delivery.status))
        }

        Text(
            "${strings.channelName(delivery.channel)} · ${delivery.createdAt}",
            color = klinikColor("textSecondary"),
        )

        if (delivery.isFallback) {
            Text(strings.historyFallback, color = klinikColor("textSecondary"))
        }

        delivery.failureReason?.let {
            Text(it, color = klinikColor("warning"))
        }
    }
}

@Composable
private fun tintFor(status: NotificationDeliveryStatus) = when (status) {
    NotificationDeliveryStatus.DELIVERED, NotificationDeliveryStatus.READ -> klinikColor("success")
    NotificationDeliveryStatus.FAILED -> klinikColor("critical")
    NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.SENT -> klinikColor("info")
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) { content() }
}

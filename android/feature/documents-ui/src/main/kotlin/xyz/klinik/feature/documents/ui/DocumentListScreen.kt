package xyz.klinik.feature.documents.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.documents.DocumentsPhase
import xyz.klinik.feature.documents.DocumentsState
import xyz.klinik.network.ClinicalDocument
import xyz.klinik.network.DocumentType
import xyz.klinik.network.ProcessingStatus
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class DocumentStrings(
    val upload: String,
    val empty: String,
    val notFound: String,
    val retry: String,
    val typeName: (DocumentType) -> String,
    val statusName: (ProcessingStatus) -> String,
    val sizeText: (Int) -> String,
    val message: (String) -> String,
)

@Composable
fun DocumentListScreen(
    state: DocumentsState,
    strings: DocumentStrings,
    canUpload: Boolean,
    onRetry: () -> Unit,
    onUpload: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            DocumentsPhase.Loading -> Centered { CircularProgressIndicator() }

            DocumentsPhase.Empty -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.empty, color = klinikColor("textSecondary"))
                    if (canUpload) TextButton(onClick = onUpload) { Text(strings.upload) }
                }
            }

            DocumentsPhase.NotFound -> Centered {
                Text(strings.notFound, color = klinikColor("textSecondary"))
            }

            is DocumentsPhase.Failed -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.message(phase.messageKey), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            DocumentsPhase.Loaded -> Loaded(state, strings, canUpload, onUpload, onLoadMore)
        }
    }
}

@Composable
private fun Loaded(
    state: DocumentsState,
    strings: DocumentStrings,
    canUpload: Boolean,
    onUpload: () -> Unit,
    onLoadMore: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        state.uploadError?.let { error ->
            val text = when (error) {
                is UiText.Key -> strings.message(error.key)
                is UiText.Literal -> error.text
            }

            Text(
                text,
                color = klinikColor("critical"),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Tokens.Spacing.lg)
                    .semantics { contentDescription = text },
            )
        }

        LazyColumn(modifier = Modifier.weight(1f)) {
            items(state.documents, key = { it.id }) { document ->
                DocumentRow(document, strings)

                if (document.id == state.documents.lastOrNull()?.id && state.hasMore) {
                    LaunchedEffect(document.id) { onLoadMore() }
                }
            }
        }

        if (canUpload) {
            Button(
                onClick = onUpload,
                enabled = !state.uploading,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Tokens.Spacing.lg)
                    .height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.upload)
            }
        }
    }
}

@Composable
private fun DocumentRow(document: ClinicalDocument, strings: DocumentStrings) {
    // Combined for a screen reader: the name, what kind of document it is and
    // where its processing has got to are one piece of information, not three.
    val spoken = "${document.originalName ?: strings.typeName(document.type)}, " +
        "${strings.typeName(document.type)}, ${strings.statusName(document.ocrStatus)}"

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Tokens.Spacing.lg)
            .semantics(mergeDescendants = true) { contentDescription = spoken },
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Text(
            document.originalName ?: strings.typeName(document.type),
            color = klinikColor("textPrimary"),
            modifier = Modifier.clearAndSetSemantics {},
        )

        Text(
            "${strings.typeName(document.type)} · ${strings.sizeText(document.size)} · " +
                strings.statusName(document.ocrStatus),
            color = statusColour(document.ocrStatus),
            modifier = Modifier.clearAndSetSemantics {},
        )
    }
}

/**
 * Colour supports the words; it never carries the meaning alone, because a
 * status a reader cannot distinguish by hue is no status at all (spec 7).
 */
@Composable
private fun statusColour(status: ProcessingStatus) = klinikColor(
    when (status) {
        ProcessingStatus.DONE -> "success"
        ProcessingStatus.FAILED -> "critical"
        else -> "textSecondary"
    },
)

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

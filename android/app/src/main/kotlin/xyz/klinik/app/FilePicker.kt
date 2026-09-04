package xyz.klinik.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/** A file the patient chose, already copied somewhere this app owns. */
data class PickedFile(
    val path: String,
    val filename: String,
    val contentType: String,
)

/**
 * Choosing a document to upload.
 *
 * The chosen file is **copied** into the app's own cache before its path is
 * returned, and that copy is the point rather than tidiness. The picker hands
 * back a `content://` URI belonging to another app, and the permission to read
 * it can be revoked the moment the picker closes — a chunked upload that
 * resumes ten minutes later would find nothing there. The copy is the
 * difference between an upload that survives being backgrounded on hotel wifi
 * and one that fails at the second chunk.
 */
@Composable
fun rememberFilePicker(onPicked: (PickedFile?) -> Unit): () -> Unit {
    val context = LocalContext.current

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) {
            onPicked(null)
            return@rememberLauncherForActivityResult
        }

        onPicked(copyIntoCache(context, uri))
    }

    // Exactly what the server accepts for a document — see DOCUMENT_MIME_TYPES
    // in backend/src/files/file-type.ts. Offering more means a patient chooses
    // a file, waits for the upload, and is then told the type is not allowed;
    // offering */* means they find that out after twenty megabytes.
    val types = remember {
        arrayOf("application/pdf", "image/jpeg", "image/png", "image/heic")
    }

    return { launcher.launch(types) }
}

/**
 * Copies the picked file into the cache and reports what it is.
 *
 * Returns null on any failure rather than throwing: the caller is a button on a
 * screen, and a crash while choosing a file is worse than a button that did
 * nothing.
 */
private fun copyIntoCache(context: Context, uri: Uri): PickedFile? = runCatching {
    val resolver = context.contentResolver
    val filename = displayName(context, uri) ?: "document"
    val contentType = resolver.getType(uri) ?: "application/octet-stream"

    val destination = File(context.cacheDir, "upload-${UUID.randomUUID()}")

    resolver.openInputStream(uri)?.use { input ->
        destination.outputStream().use { output -> input.copyTo(output) }
    } ?: return null

    PickedFile(destination.absolutePath, filename, contentType)
}.getOrNull()

/**
 * The name the patient will recognise.
 *
 * A clinician looking at "upload-9f3c…" in a file list cannot tell a passport
 * from a blood test, so the original name travels with the copy.
 */
private fun displayName(context: Context, uri: Uri): String? = runCatching {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null

            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column < 0) null else cursor.getString(column)
        }
}.getOrNull()

/** Deletes a copy once it has been sent, so the cache does not grow forever. */
suspend fun discard(file: PickedFile) {
    withContext(Dispatchers.IO) { File(file.path).delete() }
}

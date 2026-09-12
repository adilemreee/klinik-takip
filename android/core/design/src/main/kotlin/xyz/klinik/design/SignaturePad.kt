package xyz.klinik.design

import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Paint
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.io.ByteArrayOutputStream
import xyz.klinik.shell.Signature
import xyz.klinik.shell.SignaturePoint

/** Text the pad needs, resolved by the caller. */
data class SignaturePadLabels(
    val hint: String,
    val clear: String,
    val signed: String,
    val notSigned: String,
)

/**
 * A finger signature on a consent form.
 *
 * Drawn rather than typed because that is what the instrument is: a mark the
 * person made, which can be shown to them years later. It is stored as a PNG
 * on a transparent background so it can be laid over whatever the document
 * looks like when it is printed, and in black rather than the theme's ink — a
 * signature rendered in the pale grey of a dark palette is invisible on paper.
 *
 * The pad itself is invisible to a screen reader, so the label underneath says
 * whether anything has been signed. Somebody using a screen reader cannot draw
 * one, and the clinic signs on paper for them; what this must not do is claim
 * a signature that is not there.
 */
@Composable
fun SignaturePad(
    strokes: List<List<SignaturePoint>>,
    labels: SignaturePadLabels,
    onStrokes: (List<List<SignaturePoint>>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink = klinikColor("textPrimary")
    val surface = klinikColor("surface")
    val border = klinikColor("border")

    /*
     * The stroke under the finger, kept here rather than pushed up on every
     * pointer event.
     *
     * Reporting mid-drag would make the caller responsible for replacing a
     * partial stroke it never asked for, and the gesture handler would be
     * reading a `strokes` value captured when the pointer went down. The
     * committed strokes go up when the finger lifts; the line is drawn from
     * both in the meantime, so it still appears as it is made.
     */
    val live = remember { mutableStateListOf<SignaturePoint>() }
    val drawn = strokes + if (live.size > 1) listOf(live.toList()) else emptyList()
    val signed = Signature.isSigned(drawn)

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        Text(
            labels.hint,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp)
                .background(surface)
                .pointerInput(strokes) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            live.clear()
                            live.add(SignaturePoint(offset.x, offset.y))
                        },
                        onDrag = { change, _ ->
                            live.add(SignaturePoint(change.position.x, change.position.y))
                        },
                        onDragEnd = {
                            // A tap is not a stroke, and a finger brushing the
                            // screen should not sign anything.
                            if (live.size > 1) onStrokes(strokes + listOf(live.toList()))
                            live.clear()
                        },
                        onDragCancel = { live.clear() },
                    )
                }
                // The drawing itself carries no information a screen reader
                // can use; the state below does.
                .semantics { contentDescription = if (signed) labels.signed else labels.notSigned },
        ) {
            drawRect(color = border, style = Stroke(width = 2f))

            Signature.drawable(drawn).forEach { stroke ->
                val path = Path().apply {
                    moveTo(stroke.first().x, stroke.first().y)
                    stroke.drop(1).forEach { lineTo(it.x, it.y) }
                }

                drawPath(
                    path = path,
                    color = ink,
                    style = Stroke(width = 5f, cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
            }
        }

        Text(
            if (signed) labels.signed else labels.notSigned,
            fontSize = Tokens.Typography.caption.size,
            color = if (signed) klinikColor("success") else klinikColor("textSecondary"),
        )

        TextButton(
            onClick = {
                live.clear()
                onStrokes(emptyList())
            },
            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(labels.clear)
        }
    }
}

/**
 * The strokes as a base64 PNG, with no `data:` prefix — the shape the server
 * stores.
 *
 * Black on transparent, fixed: the document this is laid over may be printed
 * years later, and a signature in a theme colour would be a signature nobody
 * can read.
 */
fun signaturePng(
    strokes: List<List<SignaturePoint>>,
    width: Int,
    height: Int,
): String? {
    val drawable = Signature.drawable(strokes)
    if (drawable.isEmpty() || width <= 0 || height <= 0) return null

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(bitmap)

    val paint = Paint().apply {
        isAntiAlias = true
        color = android.graphics.Color.BLACK
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    drawable.forEach { stroke ->
        val path = android.graphics.Path().apply {
            moveTo(stroke.first().x, stroke.first().y)
            stroke.drop(1).forEach { lineTo(it.x, it.y) }
        }

        canvas.drawPath(path, paint)
    }

    val bytes = ByteArrayOutputStream().use { out ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        out.toByteArray()
    }

    bitmap.recycle()

    return Base64.encodeToString(bytes, Base64.NO_WRAP)
}

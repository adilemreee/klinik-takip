import SwiftUI

#if os(iOS)
import QuickLook

/**
 * A document, shown in the app.
 *
 * QuickLook rather than a web view: it renders the formats a clinic actually
 * sends — PDF, JPEG, HEIC, the occasional Word file — with pinch-to-zoom and
 * page thumbnails, and it does it without the file leaving the app. Handing
 * the signed URL to Safari would work and would also put a patient's lab
 * report in another app's cache and history.
 */
struct DocumentPreview: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator

        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.url = url
        controller.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL

        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            url as NSURL
        }
    }
}
#else
/// The package builds for macOS so its tests run headlessly; QuickLook's
/// SwiftUI bridge is UIKit-only, and no test opens a document.
struct DocumentPreview: View {
    let url: URL

    var body: some View {
        Text(url.lastPathComponent)
    }
}
#endif

/// What the sheet carries. A URL alone is not `Identifiable`, and the sheet
/// needs an identity to know when to re-present.
struct PreviewedDocument: Identifiable, Equatable {
    let id: String
    let url: URL
}

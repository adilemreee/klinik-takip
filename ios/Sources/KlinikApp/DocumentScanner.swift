#if canImport(VisionKit) && os(iOS)
import PDFKit
import UIKit
import VisionKit
import Vision
#endif
import Foundation
import KlinikCore

/// What a scan produced: the file to upload, and what the device could read of
/// it before it left the phone.
struct ScannedDocument: Sendable {
    let url: URL
    let contentType: String
    /// The on-device pre-read (spec M16). Empty when nothing legible was found,
    /// which is itself worth showing: a scan the phone cannot read is one the
    /// server's OCR will struggle with too.
    let preview: String
}

/**
 * Scanning a document with the camera (spec M16).
 *
 * `VNDocumentCameraViewController` is the whole of the spec's first sentence —
 * edge detection, perspective correction, multiple pages, automatic contrast —
 * in a controller Apple maintains. Writing that from scratch would be a
 * thousand lines of device-only code to arrive at a worse version of it.
 *
 * The pages become one PDF rather than several images. A tahlil is two sides of
 * one sheet, and uploading them as unrelated files leaves somebody in the
 * clinic to work out that they belong together.
 *
 * The pre-read runs on the device and is shown before anything is sent. It is
 * not used as data: the spec is explicit that OCR output is never auto-approved
 * (M16), and this text never reaches the server. Its job is to answer "is this
 * legible" while the patient is still standing where they can take it again.
 */
enum DocumentScanner {
    /// Whether this device has a document scanner at all. False in the
    /// simulator and on hardware without a camera, and the caller hides the
    /// button rather than offering one that fails when pressed.
    static var isAvailable: Bool {
        #if canImport(VisionKit) && os(iOS)
        return VNDocumentCameraViewController.isSupported
        #else
        return false
        #endif
    }

    @MainActor
    static func present() async -> ScannedDocument? {
        #if canImport(VisionKit) && os(iOS)
        guard
            VNDocumentCameraViewController.isSupported,
            let presenter = topViewControllerForScan()
        else { return nil }

        let scan: VNDocumentCameraScan? = await withCheckedContinuation { continuation in
            let controller = VNDocumentCameraViewController()
            let delegate = ScanDelegate { result in continuation.resume(returning: result) }

            controller.delegate = delegate
            // UIKit does not retain the delegate; without this it is gone
            // before the first page is captured and nothing ever resumes.
            objc_setAssociatedObject(controller, &ScanDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN)

            presenter.present(controller, animated: true)
        }

        guard let scan, scan.pageCount > 0 else { return nil }

        let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }

        guard let url = writePDF(images) else { return nil }

        return ScannedDocument(
            url: url,
            contentType: "application/pdf",
            preview: await read(images)
        )
        #else
        return nil
        #endif
    }
}

#if canImport(VisionKit) && os(iOS)
private final class ScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
    nonisolated(unsafe) static var key = 0

    private let finish: (VNDocumentCameraScan?) -> Void
    private var answered = false

    init(finish: @escaping (VNDocumentCameraScan?) -> Void) {
        self.finish = finish
    }

    /// Resumes exactly once. A continuation resumed twice is a crash, and the
    /// three delegate methods below are not mutually exclusive in every path.
    private func complete(_ scan: VNDocumentCameraScan?, from controller: UIViewController) {
        guard !answered else { return }

        answered = true
        controller.dismiss(animated: true) { self.finish(scan) }
    }

    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFinishWith scan: VNDocumentCameraScan
    ) {
        complete(scan, from: controller)
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        complete(nil, from: controller)
    }

    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFailWithError error: Error
    ) {
        complete(nil, from: controller)
    }
}

private extension DocumentScanner {
    /// One PDF, one page per scanned sheet, written under a name the clinic
    /// will see in its file list.
    static func writePDF(_ images: [UIImage]) -> URL? {
        let document = PDFDocument()

        for (index, image) in images.enumerated() {
            guard let page = PDFPage(image: image) else { continue }

            document.insert(page, at: index)
        }

        guard document.pageCount > 0 else { return nil }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("tarama-\(Int(Date().timeIntervalSince1970)).pdf")

        return document.write(to: url) ? url : nil
    }

    /**
     * What the device can read, before anything is uploaded.
     *
     * Turkish first, then English: the recognisers differ on diacritics, and a
     * tahlil printed in Turkish read as English loses every ı and ş — which is
     * exactly the text somebody is checking for legibility.
     */
    static func read(_ images: [UIImage]) async -> String {
        var lines: [String] = []

        for image in images {
            guard let cgImage = image.cgImage else { continue }

            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["tr-TR", "en-US"]
            request.usesLanguageCorrection = true

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

            try? handler.perform([request])

            let observations = request.results ?? []
            lines += observations.compactMap { $0.topCandidates(1).first?.string }
        }

        return lines.joined(separator: "\n")
    }
}

@MainActor
private func topViewControllerForScan() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let root = scenes
        .flatMap(\.windows)
        .first { $0.isKeyWindow }?
        .rootViewController

    var top = root

    while let presented = top?.presentedViewController {
        top = presented
    }

    return top
}
#endif

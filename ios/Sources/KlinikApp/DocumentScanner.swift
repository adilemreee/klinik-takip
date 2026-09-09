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
 *
 * **Nothing from VisionKit crosses an actor boundary.** `VNDocumentCameraScan`
 * and `UIImage` are not `Sendable`, and handing either to a continuation is a
 * data race the iOS compiler rejects — which the macOS build of this package
 * cannot see, because none of this file exists there. The delegate stays on the
 * main actor and resumes with page bytes, which are.
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

        let controller = VNDocumentCameraViewController()

        let pages: [Data] = await withCheckedContinuation { continuation in
            let delegate = ScanDelegate { pages in continuation.resume(returning: pages) }

            controller.delegate = delegate
            // UIKit does not retain the delegate; without this it is gone
            // before the first page is captured and nothing ever resumes.
            objc_setAssociatedObject(controller, &ScanDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN)

            presenter.present(controller, animated: true)
        }

        // Dismissed here rather than in the delegate: this function is already
        // on the main actor and holds the controller, and reaching for it from
        // a nonisolated callback is what the compiler objects to.
        controller.dismiss(animated: true)

        guard !pages.isEmpty else { return nil }
        guard let url = writePDF(pages) else { return nil }

        return ScannedDocument(url: url, contentType: "application/pdf", preview: read(pages))
        #else
        return nil
        #endif
    }
}

#if canImport(VisionKit) && os(iOS)
/**
 * The delegate.
 *
 * Carries no actor isolation of its own and hands back `[Data]`. Two reasons,
 * and both are about what may cross a boundary: `VNDocumentCameraScan` and
 * `UIImage` are not `Sendable`, so neither can reach the continuation, and the
 * page bytes can. Dismissing the controller is left to `present()`, which is
 * already on the main actor and holds the reference — reaching for it from here
 * is what made three toolchains disagree.
 */
private final class ScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate, @unchecked Sendable {
    nonisolated(unsafe) static var key = 0

    private let finish: @Sendable ([Data]) -> Void
    private let lock = NSLock()
    private var answered = false

    init(finish: @escaping @Sendable ([Data]) -> Void) {
        self.finish = finish
    }

    /**
     * Resumes exactly once.
     *
     * A continuation resumed twice is a crash, and the three callbacks below
     * are not mutually exclusive on every path. UIKit calls them on the main
     * thread, so the lock is belt and braces rather than a real contention
     * worry — but a crash is not the place to be relying on a convention.
     */
    private func complete(_ pages: [Data]) {
        lock.lock()
        let first = !answered
        answered = true
        lock.unlock()

        guard first else { return }

        finish(pages)
    }

    /**
     * The pages, as bytes.
     *
     * JPEG rather than PNG: a four-page PNG scan is tens of megabytes, and this
     * is uploaded from a hotel on somebody's data. 0.9 is high enough that the
     * on-device text recognition reads it as well as the original.
     */
    private func bytes(of scan: VNDocumentCameraScan) -> [Data] {
        (0..<scan.pageCount).compactMap { scan.imageOfPage(at: $0).jpegData(compressionQuality: 0.9) }
    }

    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFinishWith scan: VNDocumentCameraScan
    ) {
        complete(bytes(of: scan))
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        complete([])
    }

    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFailWithError error: Error
    ) {
        complete([])
    }
}

private extension DocumentScanner {
    /// One PDF, one page per scanned sheet, written under a name the clinic
    /// will see in its file list.
    static func writePDF(_ pages: [Data]) -> URL? {
        let document = PDFDocument()

        for (index, data) in pages.enumerated() {
            guard let image = UIImage(data: data), let page = PDFPage(image: image) else { continue }

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
    static func read(_ pages: [Data]) -> String {
        var lines: [String] = []

        for data in pages {
            guard let image = UIImage(data: data), let cgImage = image.cgImage else { continue }

            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["tr-TR", "en-US"]
            request.usesLanguageCorrection = true

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

            try? handler.perform([request])

            lines += (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
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

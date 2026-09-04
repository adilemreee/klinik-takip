#if canImport(UIKit)
import UIKit
import UniformTypeIdentifiers
#endif
import Foundation

/**
 * Choosing a file to upload.
 *
 * A document picker, bridged to `async` so the screens that upload can take a
 * plain `() async -> (url, contentType)?` and stay free of UIKit — which is
 * what lets their models be tested from the command line.
 *
 * The picked file is copied into the app's own temporary directory before the
 * URL is returned. The picker hands back a security-scoped URL into another
 * process's storage, and that access ends the moment the callback returns: a
 * chunked upload that resumes ten minutes later would find nothing there. A
 * copy is the difference between an upload that survives being backgrounded
 * and one that fails at the second chunk.
 */
enum FilePicker {
    @MainActor
    static func present() async -> (url: URL, contentType: String)? {
        #if canImport(UIKit)
        guard let presenter = topViewController() else { return nil }

        return await withCheckedContinuation { continuation in
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.pdf, .image, .plainText, .commaSeparatedText, .data],
                asCopy: true
            )
            let delegate = PickerDelegate { result in
                continuation.resume(returning: result)
            }

            picker.delegate = delegate
            // The delegate is the only strong reference the picker keeps, and
            // UIKit does not retain it; without this it is deallocated before
            // the user has chosen anything and the continuation never resumes.
            objc_setAssociatedObject(picker, &PickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN)

            presenter.present(picker, animated: true)
        }
        #else
        return nil
        #endif
    }
}

#if canImport(UIKit)
private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
    nonisolated(unsafe) static var key: UInt8 = 0

    private let finish: ((url: URL, contentType: String)?) -> Void
    private var hasFinished = false

    init(finish: @escaping ((url: URL, contentType: String)?) -> Void) {
        self.finish = finish
    }

    /// Both delegate callbacks can arrive for one presentation; resuming a
    /// continuation twice is a crash, not a warning.
    private func complete(_ result: (url: URL, contentType: String)?) {
        guard !hasFinished else { return }
        hasFinished = true
        finish(result)
    }

    func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let source = urls.first else {
            complete(nil)
            return
        }

        // `asCopy: true` already gives a copy in a temporary location, but that
        // location is cleaned up aggressively. Moving it somewhere this app
        // owns is what makes a resumable upload able to resume.
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(source.pathExtension)

        do {
            try FileManager.default.copyItem(at: source, to: destination)
        } catch {
            complete(nil)
            return
        }

        let type = UTType(filenameExtension: source.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"

        complete((url: destination, contentType: type))
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        complete(nil)
    }
}

@MainActor
private func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .first { $0.activationState == .foregroundActive }

    var top = scene?.windows.first(where: \.isKeyWindow)?.rootViewController

    while let presented = top?.presentedViewController {
        top = presented
    }

    return top
}
#endif

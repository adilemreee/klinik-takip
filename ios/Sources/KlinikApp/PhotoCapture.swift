#if canImport(UIKit)
import UIKit
#endif
import Foundation
import KlinikAPI

/**
 * Taking a follow-up photograph, with the previous one showing through it.
 *
 * The overlay is the clinical point, not decoration. A before/after pair shot
 * from two different angles compares nothing, and a patient photographing their
 * own abdomen three weeks after surgery has no way to remember where they stood
 * last time. Putting the earlier photograph translucently over the viewfinder
 * gives them something to line up against (spec M7).
 *
 * `UIImagePickerController` is used rather than a hand-built AVFoundation
 * session because it supports exactly this — `cameraOverlayView` — and a
 * capture screen written from scratch would be several hundred lines of
 * device-only code to reach the same place.
 *
 * Where there is no camera (the simulator, an iPad without one) it falls back
 * to the photo library and the guide is simply absent. That is honest: there is
 * nothing to line a chosen photograph up against.
 */
enum PhotoCapture {
    @MainActor
    static func present(reference: ClinicalPhoto?, referenceImage: Data?) async -> URL? {
        #if canImport(UIKit)
        guard let presenter = topViewControllerForCapture() else { return nil }

        let hasCamera = UIImagePickerController.isSourceTypeAvailable(.camera)

        return await withCheckedContinuation { continuation in
            let picker = UIImagePickerController()
            picker.sourceType = hasCamera ? .camera : .photoLibrary
            picker.allowsEditing = false

            if hasCamera, let referenceImage, let image = UIImage(data: referenceImage) {
                picker.cameraOverlayView = overlay(image, over: picker.view.bounds)
            }

            let delegate = CaptureDelegate { result in
                continuation.resume(returning: result)
            }

            picker.delegate = delegate
            // UIKit does not retain the delegate; without this it is gone
            // before the shutter and the continuation never resumes.
            objc_setAssociatedObject(picker, &CaptureDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN)

            presenter.present(picker, animated: true)
        }
        #else
        return nil
        #endif
    }
}

#if canImport(UIKit)
/**
 * The translucent guide.
 *
 * Deliberately faint and non-interactive: it has to be visible enough to line
 * up against and faint enough that the person can still see what they are
 * actually photographing. `isUserInteractionEnabled = false` matters — an
 * overlay that swallows taps takes the shutter button with it.
 */
@MainActor
private func overlay(_ image: UIImage, over bounds: CGRect) -> UIView {
    let container = UIView(frame: bounds)
    container.isUserInteractionEnabled = false
    container.backgroundColor = .clear

    let view = UIImageView(image: image)
    view.frame = bounds
    view.contentMode = .scaleAspectFit
    view.alpha = 0.35

    container.addSubview(view)

    return container
}

private final class CaptureDelegate: NSObject, UIImagePickerControllerDelegate,
                                     UINavigationControllerDelegate {
    nonisolated(unsafe) static var key: UInt8 = 0

    private let finish: (URL?) -> Void
    private var hasFinished = false

    init(finish: @escaping (URL?) -> Void) {
        self.finish = finish
    }

    private func complete(_ url: URL?) {
        guard !hasFinished else { return }
        hasFinished = true
        finish(url)
    }

    func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        picker.dismiss(animated: true)

        guard
            let image = info[.originalImage] as? UIImage,
            // 0.85 keeps wound detail — the thing a clinician is being asked to
            // look at — while staying small enough to send on hotel wifi.
            let data = image.jpegData(compressionQuality: 0.85)
        else {
            complete(nil)
            return
        }

        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")

        do {
            try data.write(to: destination)
        } catch {
            complete(nil)
            return
        }

        // The server strips EXIF, including where the photograph was taken.
        // Re-encoding through jpegData here already drops most of it; neither
        // is relied on alone.
        complete(destination)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        complete(nil)
    }
}

@MainActor
private func topViewControllerForCapture() -> UIViewController? {
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

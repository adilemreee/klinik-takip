import SwiftUI

#if canImport(CoreImage)
import CoreImage
import CoreImage.CIFilterBuiltins

/**
 * A QR code, generated on the device.
 *
 * Nothing is sent anywhere to make it: the payload is a shared secret, and a
 * round trip to a rendering service would put it in somebody else's log.
 *
 * Drawn on an explicit white ground with a black foreground rather than the
 * theme's colours. A scanner needs the contrast the format was designed
 * around, and a dark-mode QR code in grey on charcoal is one nobody's camera
 * will read.
 */
public struct QRCode: View {
    private let payload: String
    private let side: CGFloat

    public init(payload: String, side: CGFloat = 200) {
        self.payload = payload
        self.side = side
    }

    public var body: some View {
        Group {
            if let image = QRCode.image(for: payload) {
                Image(decorative: image, scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
            } else {
                // Generation can fail on a payload too long for the format.
                // The secret is printed beside this, so the screen still works.
                Color.clear
            }
        }
        .frame(width: side, height: side)
        .padding(Tokens.Spacing.md)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        // The secret is written out underneath in text, which is what a screen
        // reader can actually convey.
        .accessibilityHidden(true)
    }

    static func image(for payload: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        // Medium: room for the format's own error correction without making the
        // modules so small that a cracked screen cannot be read.
        filter.correctionLevel = "M"

        guard let output = filter.outputImage else { return nil }

        // Scaled before rasterising; the generator's native output is a few
        // dozen points across and upscaling that as a bitmap blurs the modules.
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))

        return CIContext().createCGImage(scaled, from: scaled.extent)
    }
}
#else
/// No CoreImage: the secret in text is the whole of the enrolment path.
public struct QRCode: View {
    public init(payload: String, side: CGFloat = 200) {}

    public var body: some View { Color.clear.frame(height: 0) }
}
#endif

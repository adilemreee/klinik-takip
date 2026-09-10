import SwiftUI

/**
 * A signature drawn with a finger (spec M17).
 *
 * Deliberately not PencilKit. PencilKit is built around a stylus and brings a
 * tool palette, an eraser and a colour picker with it — three things that make
 * no sense on a consent form, and one of which (the eraser) invites somebody to
 * alter a signature after the fact. This draws strokes and offers exactly two
 * verbs: clear it, or accept it.
 *
 * The strokes are kept as points rather than as an accumulated image so the
 * line stays crisp at any scale, and so "clear" is a fact about the data rather
 * than a paint operation over the top.
 */
public struct SignaturePad: View {
    /**
     * The words the pad shows and announces.
     *
     * Passed in rather than looked up, because this module deliberately has no
     * dependencies — it is the shared vocabulary between iOS and Android, and
     * a design system that imports the localisation layer stops being one.
     */
    public struct Labels: Sendable, Equatable {
        public let name: String
        public let hint: String
        public let signed: String
        public let notSigned: String

        public init(name: String, hint: String, signed: String, notSigned: String) {
            self.name = name
            self.hint = hint
            self.signed = signed
            self.notSigned = notSigned
        }
    }

    @Environment(\.colorScheme) private var scheme

    @Binding private var strokes: [[CGPoint]]
    @State private var current: [CGPoint] = []

    private let labels: Labels
    private let lineWidth: CGFloat

    public init(strokes: Binding<[[CGPoint]]>, labels: Labels, lineWidth: CGFloat = 2.5) {
        _strokes = strokes
        self.labels = labels
        self.lineWidth = lineWidth
    }

    /// Whether anything has been drawn. A single tap is not a signature, so a
    /// stroke of one point does not count.
    ///
    /// `nonisolated` because a static on a `View` otherwise inherits the
    /// view's main-actor isolation, and the tests call it directly.
    nonisolated public static func isSigned(_ strokes: [[CGPoint]]) -> Bool {
        strokes.contains { $0.count > 1 }
    }

    public var body: some View {
        ZStack {
            Canvas { context, _ in
                for stroke in strokes + [current] {
                    context.stroke(
                        SignaturePad.path(for: stroke),
                        with: .color(Tokens.Palette.textPrimary.resolve(for: scheme)),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
                    )
                }
            }

            if strokes.isEmpty && current.isEmpty {
                Text(labels.hint)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .allowsHitTesting(false)
            }

            // The line people sign on. Drawn under the strokes so a signature
            // crossing it looks like a signature crossing it.
            VStack {
                Spacer()
                Rectangle()
                    .fill(Tokens.Palette.border.resolve(for: scheme))
                    .frame(height: 1)
                    .padding(.horizontal, Tokens.Spacing.lg)
                    .padding(.bottom, Tokens.Spacing.xl)
            }
            .allowsHitTesting(false)
        }
        .frame(height: 200)
        .frame(maxWidth: .infinity)
        .background(Tokens.Palette.surface.resolve(for: scheme))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous)
                .strokeBorder(Tokens.Palette.border.resolve(for: scheme))
        )
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous))
        .gesture(
            // Zero distance, so a short signature registers from the first
            // pixel. The default minimum would swallow the start of a small
            // hand's stroke.
            DragGesture(minimumDistance: 0)
                .onChanged { value in current.append(value.location) }
                .onEnded { _ in
                    if current.count > 1 { strokes.append(current) }
                    current = []
                }
        )
        // One element to VoiceOver, because a canvas of strokes has nothing a
        // screen reader can usefully traverse. What matters is whether it has
        // been signed and how to sign it.
        .accessibilityElement()
        .accessibilityLabel(labels.name)
        .accessibilityValue(SignaturePad.isSigned(strokes) ? labels.signed : labels.notSigned)
        .accessibilityHint(labels.hint)
    }

    /// `nonisolated` because a static on a `View` otherwise inherits the view's
    /// main-actor isolation, and the tests call it directly.
    nonisolated static func path(for points: [CGPoint]) -> Path {
        var path = Path()

        guard let first = points.first else { return path }

        path.move(to: first)

        for point in points.dropFirst() {
            path.addLine(to: point)
        }

        return path
    }
}

#if canImport(UIKit)
import UIKit

public extension SignaturePad {
    /**
     * The strokes as a PNG, on a transparent background.
     *
     * Transparent rather than white so the signature can be laid over whatever
     * the consent document looks like when it is printed years later. Black,
     * fixed, rather than the theme's ink: a signature rendered in the light
     * grey of a dark-mode palette is invisible on paper.
     */
    @MainActor
    static func png(
        strokes: [[CGPoint]],
        size: CGSize,
        lineWidth: CGFloat = 2.5,
        scale: CGFloat = 2
    ) -> Data? {
        guard isSigned(strokes), size.width > 0, size.height > 0 else { return nil }

        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = false

        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            context.cgContext.setStrokeColor(UIColor.black.cgColor)
            context.cgContext.setLineWidth(lineWidth)
            context.cgContext.setLineCap(.round)
            context.cgContext.setLineJoin(.round)

            for stroke in strokes where stroke.count > 1 {
                context.cgContext.beginPath()
                context.cgContext.move(to: stroke[0])

                for point in stroke.dropFirst() {
                    context.cgContext.addLine(to: point)
                }

                context.cgContext.strokePath()
            }
        }

        return image.pngData()
    }
}
#endif

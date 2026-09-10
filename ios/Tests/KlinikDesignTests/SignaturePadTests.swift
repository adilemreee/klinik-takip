import SwiftUI
import XCTest
@testable import KlinikDesign

/**
 * What counts as a signature (spec M17).
 *
 * The rule worth protecting is the smallest one: a single tap leaves one
 * point, and a record saying somebody signed when they poked the screen is
 * worse than one saying they did not sign at all.
 */
final class SignaturePadTests: XCTestCase {
    func testNothingDrawnIsNotASignature() {
        XCTAssertFalse(SignaturePad.isSigned([]))
    }

    func testASingleTapIsNotASignature() {
        XCTAssertFalse(SignaturePad.isSigned([[CGPoint(x: 10, y: 10)]]))
    }

    func testAStrokeIsASignature() {
        XCTAssertTrue(
            SignaturePad.isSigned([[CGPoint(x: 10, y: 10), CGPoint(x: 40, y: 20)]])
        )
    }

    /// Several taps are still several taps.
    func testManySinglePointsAreStillNotASignature() {
        let taps = (0..<10).map { [CGPoint(x: Double($0), y: 10)] }

        XCTAssertFalse(SignaturePad.isSigned(taps))
    }

    func testAnEmptyStrokeDrawsNothing() {
        XCTAssertTrue(SignaturePad.path(for: []).isEmpty)
    }

    func testAStrokeDrawsAPath() {
        let path = SignaturePad.path(for: [CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 10)])

        XCTAssertFalse(path.isEmpty)
    }

    #if canImport(UIKit)
    /// Nothing drawn produces nothing to send, rather than a blank image the
    /// server would file as a signature.
    @MainActor
    func testAnUnsignedPadProducesNoImage() {
        XCTAssertNil(SignaturePad.png(strokes: [], size: CGSize(width: 300, height: 200)))
    }

    @MainActor
    func testASignedPadProducesAPNG() throws {
        let data = try XCTUnwrap(
            SignaturePad.png(
                strokes: [[CGPoint(x: 10, y: 10), CGPoint(x: 100, y: 60)]],
                size: CGSize(width: 300, height: 200)
            )
        )

        // The eight bytes every PNG starts with — the same check the server
        // makes before storing it.
        XCTAssertEqual(Array(data.prefix(8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }

    @MainActor
    func testAZeroSizedPadProducesNothing() {
        XCTAssertNil(
            SignaturePad.png(
                strokes: [[CGPoint(x: 10, y: 10), CGPoint(x: 100, y: 60)]],
                size: .zero
            )
        )
    }
    #endif
}

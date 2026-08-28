import XCTest
@testable import KlinikDesign

/// Guards the generated Swift against drifting from design/tokens.json.
///
/// CI also regenerates and diffs, which catches an out-of-date file. These
/// tests catch the other direction: a generator change that silently drops or
/// renames something the app depends on.
final class TokenParityTests: XCTestCase {
    private func loadTokens() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("design/tokens.json")

        let data = try Data(contentsOf: url)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testSpacingMatchesTheSharedSource() throws {
        let tokens = try loadTokens()
        let spacing = try XCTUnwrap(tokens["spacing"] as? [String: Int])

        XCTAssertEqual(Tokens.Spacing.xs, CGFloat(try XCTUnwrap(spacing["xs"])))
        XCTAssertEqual(Tokens.Spacing.lg, CGFloat(try XCTUnwrap(spacing["lg"])))
        XCTAssertEqual(Tokens.Spacing.xxxl, CGFloat(try XCTUnwrap(spacing["xxxl"])))
    }

    func testTouchTargetMatchesTheSharedSource() throws {
        let tokens = try loadTokens()
        let meta = try XCTUnwrap(tokens["meta"] as? [String: Any])

        XCTAssertEqual(Tokens.minimumTouchTarget, CGFloat(try XCTUnwrap(meta["minimumTouchTargetPt"] as? Int)))
    }

    func testBothSchemesDefineTheSameColourNames() throws {
        let tokens = try loadTokens()
        let color = try XCTUnwrap(tokens["color"] as? [String: [String: String]])

        XCTAssertEqual(
            Set(try XCTUnwrap(color["light"]).keys),
            Set(try XCTUnwrap(color["dark"]).keys),
            "A colour defined in only one scheme has no value in the other"
        )
    }

    func testEverySemanticStateNamesAColourThatExists() throws {
        let tokens = try loadTokens()
        let color = try XCTUnwrap(tokens["color"] as? [String: [String: String]])
        let light = try XCTUnwrap(color["light"])
        let semantic = try XCTUnwrap(tokens["semantic"] as? [String: Any])

        for (name, value) in semantic where !name.hasPrefix("$") {
            let state = try XCTUnwrap(value as? [String: String])
            let colorName = try XCTUnwrap(state["color"])

            XCTAssertNotNil(light[colorName], "\(name) references a colour that does not exist: \(colorName)")
            XCTAssertNotNil(state["icon"], "\(name) has no icon")
        }
    }
}

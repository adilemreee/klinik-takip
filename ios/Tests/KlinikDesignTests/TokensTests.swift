import SwiftUI
import XCTest
@testable import KlinikDesign

final class TokensTests: XCTestCase {
    /// Spec section 7: nothing tappable smaller than 44pt, for older patients
    /// and anyone using the app one-handed after surgery.
    func testMinimumTouchTargetMatchesTheAccessibilityFloor() {
        XCTAssertEqual(Tokens.minimumTouchTarget, 44)
    }

    func testSpacingScaleIsMonotonic() {
        let scale = [
            Tokens.Spacing.xxs, Tokens.Spacing.xs, Tokens.Spacing.sm, Tokens.Spacing.md,
            Tokens.Spacing.lg, Tokens.Spacing.xl, Tokens.Spacing.xxl, Tokens.Spacing.xxxl,
        ]

        XCTAssertEqual(scale, scale.sorted(), "A spacing scale that is not ordered invites arbitrary values")
        XCTAssertEqual(Set(scale).count, scale.count, "Two steps with the same value make one of them pointless")
    }

    /// Every clinical state carries an icon as well as a colour, because
    /// critical information must never depend on colour alone (spec section 7).
    func testEveryClinicalStateHasAnIcon() {
        let states = [
            Tokens.State.labNormal, Tokens.State.labLow, Tokens.State.labHigh,
            Tokens.State.labCritical, Tokens.State.triageInfo, Tokens.State.triageRoutine,
            Tokens.State.triageUrgent, Tokens.State.triageEmergency,
        ]

        for state in states {
            XCTAssertFalse(state.iconName.isEmpty)
        }
    }

    /// The two states a reader must never confuse are the ones that decide
    /// whether someone calls the clinic tonight.
    func testCriticalAndNormalDifferInIconAsWellAsColour() {
        XCTAssertNotEqual(Tokens.State.labCritical.iconName, Tokens.State.labNormal.iconName)
        XCTAssertNotEqual(Tokens.State.labCritical.color, Tokens.State.labNormal.color)
        XCTAssertNotEqual(Tokens.State.triageEmergency.iconName, Tokens.State.triageRoutine.iconName)
    }

    func testEveryColourDiffersBetweenSchemes() {
        // A palette entry identical in both schemes is almost always an
        // oversight; it will be unreadable in one of them.
        let pairs: [(String, ThemedColor)] = [
            ("background", Tokens.Palette.background),
            ("surface", Tokens.Palette.surface),
            ("textPrimary", Tokens.Palette.textPrimary),
            ("textSecondary", Tokens.Palette.textSecondary),
            ("accent", Tokens.Palette.accent),
            ("critical", Tokens.Palette.critical),
            ("warning", Tokens.Palette.warning),
            ("success", Tokens.Palette.success),
        ]

        for (name, color) in pairs {
            XCTAssertNotEqual(color.light, color.dark, "\(name) is the same in light and dark")
        }
    }

    func testResolvesTheRightVariantForEachScheme() {
        let color = ThemedColor(light: .black, dark: .white)

        XCTAssertEqual(color.resolve(for: .light), .black)
        XCTAssertEqual(color.resolve(for: .dark), .white)
    }
}

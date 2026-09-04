import XCTest
import KlinikHomeFeature
@testable import KlinikApp

/**
 * Where the home screen's five actions lead (T2.6).
 *
 * Worth pinning because the interesting case is the one that leads *nowhere*:
 * the emergency button arms a two-step confirmation in place, and pushing a
 * screen would put a navigation animation between a patient and the button
 * they just pressed.
 */
final class PatientDestinationTests: XCTestCase {
    @MainActor
    func testEmergencyDoesNotNavigate() {
        XCTAssertNil(
            PatientHomeView.destination(for: .emergency),
            "the emergency action confirms in place; navigating away from it loses the second press"
        )
    }

    @MainActor
    func testEveryOtherActionLeadsSomewhere() {
        // A tile that does nothing when tapped reads as a broken app, and this
        // is the screen where that matters most.
        for action in HomeAction.allCases where action != .emergency {
            XCTAssertNotNil(
                PatientHomeView.destination(for: action),
                "\(action) is on the home screen and must lead somewhere"
            )
        }
    }

    @MainActor
    func testActionsLeadToTheirOwnDestinations() {
        XCTAssertEqual(PatientHomeView.destination(for: .messages), .messages)
        XCTAssertEqual(PatientHomeView.destination(for: .uploadDocument), .documents)
        XCTAssertEqual(PatientHomeView.destination(for: .medications), .medications)
        XCTAssertEqual(PatientHomeView.destination(for: .addPhoto), .photos)
    }

    @MainActor
    func testNoTwoActionsShareADestination() {
        // A copy-paste in the switch would silently send two tiles to the same
        // screen, and the one that lost would look broken rather than wrong.
        let destinations = HomeAction.allCases.compactMap { PatientHomeView.destination(for: $0) }

        XCTAssertEqual(
            destinations.count,
            Set(destinations).count,
            "two home actions lead to the same screen"
        )
    }
}

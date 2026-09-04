import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikApp

/**
 * What the app shows, and to whom (T2.3–T2.5).
 *
 * The shell's only real decision, and the one worth testing hardest: getting it
 * wrong shows the wrong person the wrong thing. A patient must never land on
 * the staff patient list, and a signed-out user must never land anywhere but
 * sign-in — both of which are one `if` away from being accidentally true.
 */
final class RootRouteTests: XCTestCase {
    private func identity(
        role: UserRole,
        isStaff: Bool,
        patientId: String? = nil
    ) -> Identity {
        Identity(
            userId: "u1",
            role: role,
            displayName: "Ayşe",
            patientId: patientId,
            isStaff: isStaff
        )
    }

    private func route(_ session: SessionState, _ identity: Identity?) -> RootRoute? {
        Root.route(for: RootInput(session: session, identity: identity))
    }

    // MARK: - No session

    func testSignedOutGoesToSignInWithoutWaitingForAnything() {
        // No identity call is possible without a token, so the answer must not
        // depend on one.
        XCTAssertEqual(route(.signedOut, nil), .signIn)
    }

    func testAnExpiredSessionSaysSoRatherThanLookingLikeAFreshStart() {
        // The user did nothing wrong. A plain sign-in screen leaves them
        // wondering whether their account is gone.
        XCTAssertEqual(route(.expired, nil), .signInAgain)
        XCTAssertNotEqual(route(.expired, nil), .signIn)
    }

    func testAStaleIdentityCannotKeepSomebodySignedIn() {
        // The session is the authority. An identity left over in memory must
        // not route a signed-out user into the app.
        let stale = identity(role: .doctor, isStaff: true)

        XCTAssertEqual(route(.signedOut, stale), .signIn)
        XCTAssertEqual(route(.expired, stale), .signInAgain)
    }

    // MARK: - Signed in, still asking who

    func testWaitsRatherThanGuessingWhileTheIdentityIsInFlight() {
        // Guessing sign-in here would flash the login screen at somebody who is
        // already signed in, on every single launch.
        XCTAssertNil(route(.signedIn, nil))
    }

    // MARK: - Staff

    func testEveryStaffRoleLandsOnTheStaffHome() {
        for role in [UserRole.doctor, .nurse, .coordinator, .superAdmin, .finance] {
            XCTAssertEqual(
                route(.signedIn, identity(role: role, isStaff: true)),
                .staffHome(role: role),
                "\(role) should reach the staff home"
            )
        }
    }

    // MARK: - Patients

    func testAPatientLandsOnTheirOwnFile() {
        let route = route(.signedIn, identity(role: .patient, isStaff: false, patientId: "p1"))

        XCTAssertEqual(route, .patientHome(patientId: "p1"))
    }

    func testAPatientWhoseFileIsNotLinkedYetStillGetsTheirHome() {
        // An account activated from an invitation exists before it is linked.
        // Refusing to route would show a blank screen to somebody who signed in
        // correctly.
        let route = route(.signedIn, identity(role: .patient, isStaff: false, patientId: nil))

        XCTAssertEqual(route, .patientHome(patientId: nil))
    }

    func testAPatientNeverReachesTheStaffList() {
        // The property that matters most in this file.
        for patientId in [nil, "p1"] {
            let result = route(.signedIn, identity(role: .patient, isStaff: false, patientId: patientId))

            switch result {
            case .staffHome:
                XCTFail("a patient must never reach the staff home")
            default:
                break
            }
        }
    }

    // MARK: - The roles this app has no screen for

    func testACaregiverIsRefusedRatherThanShownSomebodyElsesFile() {
        // Section 2 gives a caregiver limited access to another person's file,
        // and there is no screen for that yet. Routing them to a patient home
        // that is not theirs would be worse than saying so.
        XCTAssertEqual(
            route(.signedIn, identity(role: .caregiver, isStaff: false)),
            .unsupported(role: .caregiver)
        )
    }

    func testTheStaffFlagDecides_NotTheRoleName() {
        // If the server ever says a role is not staff, the shell believes the
        // server rather than its own list.
        let result = route(.signedIn, identity(role: .nurse, isStaff: false))

        XCTAssertEqual(result, .unsupported(role: .nurse))
    }

    func testEveryRoleGetsSomeAnswer() {
        // No signed-in account may fall through to a blank screen.
        for role in UserRole.allCases {
            let staff = route(.signedIn, identity(role: role, isStaff: true))
            let notStaff = route(.signedIn, identity(role: role, isStaff: false))

            XCTAssertNotNil(staff, "\(role) as staff")
            XCTAssertNotNil(notStaff, "\(role) as non-staff")
        }
    }
}

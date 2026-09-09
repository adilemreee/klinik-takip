import XCTest
import KlinikCore
@testable import KlinikPatientsFeature

/// The one decision the invite form makes before the server sees it.
final class InviteModelTests: XCTestCase {
    /// An invitation with nowhere to send it is a code nobody receives.
    func testOneContactDetailIsRequired() {
        XCTAssertNotNil(InviteModel.problem(email: "", phone: ""))
        XCTAssertNotNil(InviteModel.problem(email: "   ", phone: "  "))
        XCTAssertNil(InviteModel.problem(email: "ayse@example.com", phone: ""))
        XCTAssertNil(InviteModel.problem(email: "", phone: "+905551112233"))
    }

    /// Catches the phone number typed into the e-mail box, and nothing more:
    /// the server owns address grammar, and a client that guessed at it would
    /// refuse addresses the server accepts.
    func testAnObviouslyWrongEmailIsCaught() {
        XCTAssertNotNil(InviteModel.problem(email: "05551112233", phone: ""))
        XCTAssertNil(InviteModel.problem(email: "a@b", phone: ""))
    }
}

import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikAuthFeature

private actor ScriptedTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private(set) var requests: [URLRequest] = []

    init(_ responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.isEmpty ? HTTPResponse(status: 500, body: Data()) : responses.removeFirst()
    }

    func sent() -> [URLRequest] { requests }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        XCTFail("The sign-in flow must not refresh")
        throw APIError.unknown(status: 0)
    }
}

final class AuthFlowTests: XCTestCase {
    private func json(_ text: String, status: Int = 200) -> HTTPResponse {
        HTTPResponse(status: status, body: Data(text.utf8))
    }

    private func makeFlow(
        _ responses: [HTTPResponse]
    ) -> (AuthFlowModel, ScriptedTransport, SessionManager) {
        let transport = ScriptedTransport(responses)
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )

        return (AuthFlowModel(auth: AuthAPI(client: client), session: session), transport, session)
    }

    private let successBody = #"{"status":"OK","accessToken":"a","refreshToken":"r","expiresIn":900}"#

    func testSignsInWhenNoSecondFactorIsRequired() async {
        let (flow, _, session) = makeFlow([json(successBody)])

        await flow.submitCredentials(identifier: "patient@test.local", password: "pw", deviceName: "iPhone")

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .signedIn)
        XCTAssertNil(state.errorMessage)

        let tokens = await session.currentTokens()
        XCTAssertEqual(tokens?.accessToken, "a")
    }

    func testAsksForACodeWhenTheAccountHasASecondFactor() async {
        let (flow, _, _) = makeFlow([json(#"{"status":"MFA_REQUIRED"}"#)])

        await flow.submitCredentials(identifier: "doctor@test.local", password: "pw", deviceName: nil)

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .twoFactorCode)
        XCTAssertNil(state.errorMessage)
    }

    /// The user should not retype their password for the second factor.
    func testRemembersTheCredentialsForTheCodeStep() async {
        let (flow, transport, _) = makeFlow([
            json(#"{"status":"MFA_REQUIRED"}"#),
            json(successBody),
        ])

        await flow.submitCredentials(identifier: "doctor@test.local", password: "secret-pw", deviceName: nil)
        await flow.submitTwoFactorCode("123456")

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .signedIn)

        let sent = await transport.sent()
        let body = try? JSONSerialization.jsonObject(with: sent[1].httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["identifier"] as? String, "doctor@test.local")
        XCTAssertEqual(body?["password"] as? String, "secret-pw")
        XCTAssertEqual(body?["totpCode"] as? String, "123456")
    }

    /// Staff with no second factor: the login returns no session, only a token
    /// that can enrol one.
    func testStartsEnrolmentForStaffWithoutASecondFactor() async {
        let (flow, transport, session) = makeFlow([
            json(#"{"status":"MFA_SETUP_REQUIRED","setupToken":"setup-token-value"}"#),
            json(#"{"secret":"JBSWY3DPEHPK3PXP","uri":"otpauth://totp/Klinik?secret=JBSWY3DPEHPK3PXP"}"#),
        ])

        await flow.submitCredentials(identifier: "nurse@test.local", password: "pw", deviceName: nil)

        let state = await flow.currentState()
        guard case .twoFactorSetup(let secret, let uri) = state.step else {
            return XCTFail("Expected the enrolment step, got \(state.step)")
        }

        XCTAssertEqual(secret, "JBSWY3DPEHPK3PXP")
        XCTAssertTrue(uri.hasPrefix("otpauth://"))

        // No session yet: the account is not usable until 2FA exists.
        let tokens = await session.currentTokens()
        XCTAssertNil(tokens)

        // Enrolment is reached with the scoped token, not a session token.
        let sent = await transport.sent()
        XCTAssertEqual(sent[1].value(forHTTPHeaderField: "Authorization"), "Bearer setup-token-value")
    }

    /// Confirming enrolment does not sign the user in. The backend refuses a
    /// TOTP code twice, so the login that follows needs the *next* code.
    func testEnrolmentConfirmationLeadsToTheCodeStepRatherThanStraightIn() async {
        let (flow, _, session) = makeFlow([
            json(#"{"status":"MFA_SETUP_REQUIRED","setupToken":"setup-token-value"}"#),
            json(#"{"secret":"S","uri":"otpauth://totp/x"}"#),
            json("", status: 204),
        ])

        await flow.submitCredentials(identifier: "nurse@test.local", password: "pw", deviceName: nil)
        await flow.confirmTwoFactorSetup(code: "111111")

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .twoFactorCode)

        let tokens = await session.currentTokens()
        XCTAssertNil(tokens)
    }

    func testCompletesTheWholeStaffOnboardingSequence() async {
        let (flow, _, session) = makeFlow([
            json(#"{"status":"MFA_SETUP_REQUIRED","setupToken":"t"}"#),
            json(#"{"secret":"S","uri":"otpauth://totp/x"}"#),
            json("", status: 204),
            json(successBody),
        ])

        await flow.submitCredentials(identifier: "nurse@test.local", password: "pw", deviceName: nil)
        await flow.confirmTwoFactorSetup(code: "111111")
        await flow.submitTwoFactorCode("222222")

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .signedIn)
        let tokens = await session.currentTokens()
        XCTAssertEqual(tokens?.accessToken, "a")
    }

    func testShowsALocalisedMessageForWrongCredentials() async {
        let (flow, _, _) = makeFlow([
            json(#"{"statusCode":401,"message":"INVALID_CREDENTIALS"}"#, status: 401),
        ])

        await flow.submitCredentials(identifier: "a@b.co", password: "wrong", deviceName: nil)

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .credentials)
        XCTAssertEqual(state.errorMessage, L10n.string("auth.error.invalidCredentials"))
        XCTAssertFalse(state.isLockedOut)
    }

    /// A locked account is not a typo, so the screen says something different.
    func testFlagsALockedAccountSeparately() async {
        let (flow, _, _) = makeFlow([
            json(#"{"statusCode":401,"message":"ACCOUNT_LOCKED"}"#, status: 401),
        ])

        await flow.submitCredentials(identifier: "a@b.co", password: "pw", deviceName: nil)

        let state = await flow.currentState()
        XCTAssertTrue(state.isLockedOut)
        XCTAssertEqual(state.errorMessage, L10n.string("auth.error.accountLocked"))
    }

    func testReportsAWrongTwoFactorCodeWithoutLosingTheStep() async {
        let (flow, _, _) = makeFlow([
            json(#"{"status":"MFA_REQUIRED"}"#),
            json(#"{"statusCode":401,"message":"MFA_INVALID"}"#, status: 401),
        ])

        await flow.submitCredentials(identifier: "a@b.co", password: "pw", deviceName: nil)
        await flow.submitTwoFactorCode("000000")

        let state = await flow.currentState()
        // Still on the code step: the user retypes the code, not the password.
        XCTAssertEqual(state.step, .twoFactorCode)
        XCTAssertEqual(state.errorMessage, L10n.string("auth.error.mfaInvalid"))
    }

    func testShowsAMessageWhenOffline() async {
        let transport = ScriptedTransport([])
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: OfflineTransport(),
            session: session
        )
        let flow = AuthFlowModel(auth: AuthAPI(client: client), session: session)

        await flow.submitCredentials(identifier: "a@b.co", password: "pw", deviceName: nil)

        let state = await flow.currentState()
        XCTAssertEqual(state.errorMessage, L10n.string("error.offline"))
        _ = transport
    }

    func testClearsAnEarlierErrorOnTheNextAttempt() async {
        let (flow, _, _) = makeFlow([
            json(#"{"statusCode":401,"message":"INVALID_CREDENTIALS"}"#, status: 401),
            json(successBody),
        ])

        await flow.submitCredentials(identifier: "a@b.co", password: "wrong", deviceName: nil)
        await flow.submitCredentials(identifier: "a@b.co", password: "right", deviceName: nil)

        let state = await flow.currentState()
        XCTAssertNil(state.errorMessage)
        XCTAssertEqual(state.step, .signedIn)
    }

    /// Sending the code before the password step has happened means the flow
    /// was restarted; going back beats failing silently.
    func testReturnsToTheStartIfTheCodeArrivesWithoutCredentials() async {
        let (flow, transport, _) = makeFlow([json(successBody)])

        await flow.submitTwoFactorCode("123456")

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .credentials)
        let sent = await transport.sent()
        XCTAssertTrue(sent.isEmpty, "Nothing should be sent without credentials")
    }

    func testResetClearsEverything() async {
        let (flow, _, _) = makeFlow([json(#"{"status":"MFA_REQUIRED"}"#)])

        await flow.submitCredentials(identifier: "a@b.co", password: "pw", deviceName: nil)
        await flow.reset()

        let state = await flow.currentState()
        XCTAssertEqual(state.step, .credentials)
        XCTAssertNil(state.errorMessage)
        XCTAssertFalse(state.isLockedOut)
    }
}

private struct OfflineTransport: HTTPTransport {
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        throw APIError.offline
    }
}

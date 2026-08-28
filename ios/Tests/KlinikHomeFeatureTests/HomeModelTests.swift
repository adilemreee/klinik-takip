import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikHomeFeature

private struct StatusTransport: HTTPTransport {
    let status: Int
    let body: String

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        HTTPResponse(status: status, body: Data(body.utf8))
    }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

final class HomeModelTests: XCTestCase {
    private func summaryBody(
        unread: Int = 0,
        due: Int = 0,
        missing: Int = 0,
        appointment: Bool = false
    ) -> String {
        let next = appointment
            ? #"{"id":"a1","scheduledAt":"2026-09-01T09:00:00.000Z","type":"CONTROL","location":"Klinik"}"#
            : "null"

        return """
        {"patient":{"id":"p1","mrn":"2026-K7RMPX","firstName":"Ayse","lastName":"Yilmaz",
         "preferredLanguage":"tr","status":"POST_OP"},
         "nextAppointment":\(next),"medicationsDueToday":\(due),
         "unreadMessages":\(unread),"missingDocuments":\(missing)}
        """
    }

    private func model(_ transport: HTTPTransport) async -> HomeModel {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        try? await session.signIn(
            with: SessionTokens(
                accessToken: "a",
                refreshToken: "r",
                expiresAt: Date().addingTimeInterval(900)
            )
        )
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )
        return HomeModel(api: MeAPI(client: client))
    }

    func testLoadsTheSummary() async {
        let home = await model(StatusTransport(status: 200, body: summaryBody(appointment: true)))

        await home.load()

        let state = await home.currentState()
        guard case .loaded(let summary) = state.phase else {
            return XCTFail("Expected a loaded summary, got \(state.phase)")
        }
        XCTAssertEqual(summary.patient.fullName, "Ayse Yilmaz")
        XCTAssertNotNil(summary.nextAppointment)
    }

    /// A tile reading "0" tells the reader nothing and competes for attention
    /// with the ones that matter.
    func testShowsNoBadgeForAZeroCount() async {
        let home = await model(StatusTransport(status: 200, body: summaryBody()))

        await home.load()

        let state = await home.currentState()
        XCTAssertEqual(state.badges, [:])
    }

    func testBadgesOnlyTheCountsThatAreNonZero() async {
        let home = await model(
            StatusTransport(status: 200, body: summaryBody(unread: 3, due: 0, missing: 2))
        )

        await home.load()

        let state = await home.currentState()
        XCTAssertEqual(state.badges[HomeAction.messages.rawValue], 3)
        XCTAssertEqual(state.badges[HomeAction.uploadDocument.rawValue], 2)
        XCTAssertNil(state.badges[HomeAction.medications.rawValue])
    }

    /// Not a failure to retry: the account simply has no file yet, so the
    /// screen explains instead of offering a button that will not help.
    func testReportsAnUnlinkedAccountAsItsOwnState() async {
        let home = await model(StatusTransport(status: 404, body: "{}"))

        await home.load()

        let state = await home.currentState()
        XCTAssertEqual(state.phase, .noPatientFile)
    }

    func testReportsOtherFailuresWithAMessage() async {
        let home = await model(StatusTransport(status: 503, body: "{}"))

        await home.load()

        let state = await home.currentState()
        XCTAssertEqual(state.phase, .failed(L10n.string("error.server")))
    }

    /// Spec section 7 caps the patient home at five actions. The limit is the
    /// point: a sixth would be a decision to make the screen harder for the
    /// people least able to absorb it.
    func testOffersExactlyFivePrimaryActions() {
        XCTAssertEqual(HomeAction.allCases.count, 5)
    }

    func testEveryActionHasAnIconAndATitleKey() {
        for action in HomeAction.allCases {
            XCTAssertFalse(action.iconName.isEmpty)
            XCTAssertNotEqual(
                L10n.string(action.titleKey),
                action.titleKey,
                "\(action.rawValue) has no translation"
            )
        }
    }
}

// MARK: - Emergency

private actor RecordingTrigger: EmergencyTrigger {
    private let outcome: Result<Void, APIError>
    private(set) var callCount = 0
    private(set) var notes: [String?] = []

    init(outcome: Result<Void, APIError> = .success(())) {
        self.outcome = outcome
    }

    func trigger(note: String?) async throws {
        callCount += 1
        notes.append(note)
        try outcome.get()
    }

    func count() -> Int { callCount }
    func sentNotes() -> [String?] { notes }
}

final class EmergencyModelTests: XCTestCase {
    /// A stray tap in a pocket must not summon the clinic.
    func testTheFirstTapArmsButSendsNothing() async {
        let trigger = RecordingTrigger()
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 5)

        await model.arm()

        let state = await model.currentState()
        guard case .confirming = state.phase else {
            return XCTFail("Expected the armed state, got \(state.phase)")
        }
        let count = await trigger.count()
        XCTAssertEqual(count, 0, "Arming must not send")
    }

    func testTheSecondTapSends() async {
        let trigger = RecordingTrigger()
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 5)

        await model.arm(note: "Yara kanıyor")
        await model.confirm()

        let state = await model.currentState()
        XCTAssertEqual(state.phase, .sent)
        let notes = await trigger.sentNotes()
        XCTAssertEqual(notes, ["Yara kanıyor"])
    }

    /// A button that stays armed indefinitely is one a pocket eventually presses.
    func testItDisarmsItselfWhenTheWindowPasses() async {
        let trigger = RecordingTrigger()
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 1)

        await model.arm()
        try? await Task.sleep(for: .milliseconds(1500))

        let state = await model.currentState()
        XCTAssertEqual(state.phase, .idle)
        let count = await trigger.count()
        XCTAssertEqual(count, 0)
    }

    func testConfirmingAfterTheWindowSendsNothing() async {
        let trigger = RecordingTrigger()
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 1)

        await model.arm()
        try? await Task.sleep(for: .milliseconds(1500))
        await model.confirm()

        let count = await trigger.count()
        XCTAssertEqual(count, 0, "A lapsed confirmation must not send")
    }

    func testCancelDisarms() async {
        let trigger = RecordingTrigger()
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 5)

        await model.arm()
        await model.cancel()
        await model.confirm()

        let state = await model.currentState()
        XCTAssertEqual(state.phase, .idle)
        let count = await trigger.count()
        XCTAssertEqual(count, 0)
    }

    /**
     The property that matters most.

     Reporting "the clinic has been notified" when nothing was sent would leave
     someone waiting for help that is not coming. Failure says so plainly and
     points at the local emergency number.
     */
    func testAFailureNeverReadsAsSuccess() async {
        let trigger = RecordingTrigger(outcome: .failure(.offline))
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 5)

        await model.arm()
        await model.confirm()

        let state = await model.currentState()
        guard case .failed(let message, let canRetry) = state.phase else {
            return XCTFail("Expected a failure, got \(state.phase)")
        }

        XCTAssertTrue(canRetry)
        XCTAssertEqual(message, L10n.string("emergency.notSentRetry"))
        // The message has to name the situation, not soften it.
        XCTAssertTrue(
            message.contains("ULAŞMADI") || message.uppercased().contains("NOT"),
            "The wording must make clear the alert did not arrive"
        )
    }

    func testSuccessIsOnlyReportedAfterTheServerAccepts() async {
        let trigger = RecordingTrigger(outcome: .failure(.server(ErrorResponse(statusCode: 500, message: ""))))
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 5)

        await model.arm()
        await model.confirm()

        let state = await model.currentState()
        XCTAssertNotEqual(state.phase, .sent)
    }

    func testAFailedAlertCanBeSentAgain() async {
        let trigger = RecordingTrigger(outcome: .failure(.offline))
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 5)

        await model.arm()
        await model.confirm()
        await model.acknowledge()
        await model.arm()
        await model.confirm()

        let count = await trigger.count()
        XCTAssertEqual(count, 2)
    }

    func testArmingTwiceDoesNotRestartTheWindow() async {
        let trigger = RecordingTrigger()
        let model = EmergencyModel(trigger: trigger, confirmationWindowSeconds: 5)

        await model.arm(note: "first")
        await model.arm(note: "second")
        await model.confirm()

        let notes = await trigger.sentNotes()
        XCTAssertEqual(notes, ["first"], "The armed alert keeps the note it was armed with")
    }
}

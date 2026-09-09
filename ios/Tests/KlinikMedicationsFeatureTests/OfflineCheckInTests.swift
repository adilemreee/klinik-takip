import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikMedicationsFeature

/// Reads work, writes do not — a patient who took a tablet in a hotel room
/// with no signal.
private actor ReadsOnlyTransport: HTTPTransport {
    private let body: String

    init(body: String) {
        self.body = body
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        if request.httpMethod != "GET" { throw APIError.offline }

        return HTTPResponse(status: 200, body: Data(body.utf8))
    }
}

/// Both halves of the queue: takes a write and hands it back.
private actor FakeQueue: PendingWriteQueue, PendingWriteReader {
    private var writes: [PendingWrite] = []

    func enqueue(_ write: PendingWrite) async throws { writes.append(write) }

    func unsent(entityType: String) async -> [PendingWrite] {
        writes.filter { $0.entityType == entityType }
    }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

/**
 * A dose checked in with no connection (spec M15).
 *
 * The dose is the one thing in this app whose whole value is the timestamp: a
 * patient who took their antibiotic at nine and could only say so at midnight
 * has an adherence record that is wrong by three hours.
 *
 * What the screen shows afterwards is the point of these tests. Snapping the
 * row back to "not taken" reads as the app having ignored the tap; showing a
 * plain tick claims the clinic knows. Both halves have to be said.
 */
final class OfflineCheckInTests: XCTestCase {
    private let mineJSON = """
    {
      "medications": [],
      "today": [
        {
          "id": "d1",
          "medicationId": "m1",
          "scheduledAt": "2026-01-02T09:00:00.000Z",
          "takenAt": null,
          "status": "PENDING",
          "snoozedUntil": null
        }
      ],
      "overall": {"score": null, "taken": 0, "missed": 0, "due": 1, "upcoming": 0, "streak": 0},
      "badges": []
    }
    """

    private func model(_ queue: FakeQueue) async -> MedicationsModel {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        try? await session.signIn(
            with: SessionTokens(
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: Date().addingTimeInterval(900)
            )
        )
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: ReadsOnlyTransport(body: mineJSON),
            session: session
        )
        await client.useQueue(queue)

        return MedicationsModel(api: MedicationsAPI(client: client), queue: queue)
    }

    func testTheRowSaysWhatWasChosenAndThatItIsNotSent() async {
        let queue = FakeQueue()
        let medications = await model(queue)
        await medications.refresh()

        let accepted = await medications.checkIn("d1", action: .taken)

        XCTAssertTrue(accepted)

        let state = await medications.currentState()
        XCTAssertEqual(state.unsent["d1"], .taken)
        XCTAssertNil(state.error, "Nothing went wrong from the patient's side")
        XCTAssertEqual(
            state.today.first?.status,
            .pending,
            "The clinic's own record is not rewritten locally"
        )
    }

    func testACheckInSurvivesTheScreenBeingReopened() async {
        let queue = FakeQueue()
        let first = await model(queue)
        await first.refresh()
        _ = await first.checkIn("d1", action: .skipped)

        let reopened = await model(queue)
        await reopened.refresh()

        let state = await reopened.currentState()
        XCTAssertEqual(state.unsent["d1"], .skipped)
    }

    /// Two check-ins on one dose are sent in order, and what the patient chose
    /// most recently is what they meant.
    func testTheLatestChoiceForADoseIsTheOneShown() async {
        let queue = FakeQueue()
        let medications = await model(queue)
        await medications.refresh()

        _ = await medications.checkIn("d1", action: .snooze, snoozeMinutes: 30)
        _ = await medications.checkIn("d1", action: .taken)
        await medications.refresh()

        let state = await medications.currentState()
        XCTAssertEqual(state.unsent["d1"], .taken)
    }
}

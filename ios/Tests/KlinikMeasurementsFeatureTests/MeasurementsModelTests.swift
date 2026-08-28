import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikMeasurementsFeature

/// Replies by path, and remembers every request, so a test can check both what
/// was sent and what was asked for afterwards.
private actor RecordingTransport: HTTPTransport {
    private let bodies: [String: (Int, String)]
    private(set) var paths: [String] = []
    private(set) var sentBodies: [Data] = []

    init(bodies: [String: (Int, String)]) {
        self.bodies = bodies
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        paths.append(path)
        if let body = request.httpBody { sentBodies.append(body) }

        guard let (status, body) = bodies[path] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func requestedPaths() -> [String] { paths }
    func bodiesSent() -> [Data] { sentBodies }
}

private struct FailingTransport: HTTPTransport {
    let error: APIError
    func send(_ request: URLRequest) async throws -> HTTPResponse { throw error }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

final class MeasurementsModelTests: XCTestCase {
    private let chartJSON = """
    {
      "weight": [
        {"measuredAt":"2026-01-02T08:00:00.000Z","value":66.2,"secondaryValue":null,"unit":"kg","source":"NURSE"}
      ],
      "bmi": [
        {"measuredAt":"2026-01-02T08:00:00.000Z","bmi":22.9,"category":"NORMAL","weightKg":66.2,"heightCm":170}
      ],
      "targetWeightKg": 65,
      "targetBmi": 22.5
    }
    """

    private let emptyChartJSON = """
    {"weight": [], "bmi": [], "targetWeightKg": null, "targetBmi": null}
    """

    private func model(
        _ transport: HTTPTransport,
        subject: MeasurementSubject = .patient(id: "p1")
    ) async -> MeasurementsModel {
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
            transport: transport,
            session: session
        )
        return MeasurementsModel(api: MeasurementsAPI(client: client), subject: subject)
    }

    func testLoadsTheChart() async {
        let measurements = await model(
            RecordingTransport(bodies: ["/patients/p1/measurements/chart": (200, chartJSON)])
        )

        await measurements.load()

        guard case .loaded(let chart) = await measurements.currentState().phase else {
            return XCTFail("expected a loaded chart")
        }

        XCTAssertEqual(chart.weight.first?.value, 66.2)
        XCTAssertEqual(chart.bmi.first?.category, .normal)
        XCTAssertEqual(chart.targetWeightKg, 65)
        XCTAssertEqual(chart.targetBmi, 22.5)
    }

    /// Nothing recorded yet is not a failure, and must not be shown as one.
    func testReportsEmptySeparatelyFromFailure() async {
        let measurements = await model(
            RecordingTransport(bodies: ["/patients/p1/measurements/chart": (200, emptyChartJSON)])
        )

        await measurements.load()

        let phase = await measurements.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    /// Out of scope and absent are the same answer on purpose; the message must
    /// not suggest the record exists.
    func testTreatsNotFoundAsItsOwnState() async {
        let measurements = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await measurements.load()

        let phase = await measurements.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }

    /// The chart is redrawn from the server rather than appended to locally:
    /// a new weight can move more of the BMI curve than the point just added.
    func testRefetchesTheChartAfterRecording() async {
        let transport = RecordingTransport(bodies: [
            "/patients/p1/measurements": (201, "{}"),
            "/patients/p1/measurements/chart": (200, chartJSON),
        ])
        let measurements = await model(transport)

        let saved = await measurements.record(NewMeasurement(type: .weight, value: 66.2))

        let paths = await transport.requestedPaths()

        XCTAssertTrue(saved)
        XCTAssertEqual(paths, ["/patients/p1/measurements", "/patients/p1/measurements/chart"])
    }

    /// Staff readings carry the source; a clinician has to be able to tell a
    /// home scale from a clinic one.
    func testSendsTheSourceOnTheStaffPath() async throws {
        let transport = RecordingTransport(bodies: [
            "/patients/p1/measurements": (201, "{}"),
            "/patients/p1/measurements/chart": (200, chartJSON),
        ])
        let measurements = await model(transport)

        await measurements.record(NewMeasurement(type: .weight, value: 66.2))

        let bodies = await transport.bodiesSent()
        let sent = try XCTUnwrap(bodies.first)
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: sent) as? [String: Any]
        )

        XCTAssertEqual(json["source"] as? String, "NURSE")
    }

    /// On the patient's own path the server refuses the field outright, so it
    /// must not be sent at all — sending it would turn every entry into a 400.
    func testOmitsTheSourceOnThePatientPath() async throws {
        let transport = RecordingTransport(bodies: [
            "/me/measurements": (201, "{}"),
            "/me/measurements/chart": (200, chartJSON),
        ])
        let measurements = await model(transport, subject: .me)

        await measurements.record(NewMeasurement(type: .weight, value: 66.2))

        let bodies = await transport.bodiesSent()
        let sent = try XCTUnwrap(bodies.first)
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: sent) as? [String: Any]
        )

        XCTAssertNil(json["source"])
        XCTAssertEqual(json["type"] as? String, "WEIGHT")
    }

    /// A refused reading keeps the server's message, which names the bound that
    /// was crossed; replacing it with our own would hide which one.
    func testKeepsTheServerMessageWhenAValueIsRefused() async {
        let measurements = await model(
            FailingTransport(
                error: .validation(
                    ErrorResponse(statusCode: 400, message: "Weight must be between 20 and 400 kg")
                )
            )
        )

        let saved = await measurements.record(NewMeasurement(type: .weight, value: 800))

        XCTAssertFalse(saved)
        let saveError = await measurements.currentState().saveError

        XCTAssertEqual(saveError, "Weight must be between 20 and 400 kg")
    }

    /// A double tap must not record the same weight twice.
    func testRefusesASecondSaveWhileOneIsInFlight() async {
        let transport = RecordingTransport(bodies: [
            "/patients/p1/measurements": (201, "{}"),
            "/patients/p1/measurements/chart": (200, chartJSON),
        ])
        let measurements = await model(transport)

        async let first = measurements.record(NewMeasurement(type: .weight, value: 66.2))
        async let second = measurements.record(NewMeasurement(type: .weight, value: 66.2))

        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
    }
}

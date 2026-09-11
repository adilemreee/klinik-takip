import XCTest
@testable import KlinikAPI
import KlinikCore

/**
 * What a `URLError` means to the rest of the app.
 *
 * This mapping is not cosmetic. A failure filed as `unknown` is not
 * `isConnectivity`, so the client neither queues the write nor falls back to
 * the cache nor raises the offline bar — the reading the patient typed is
 * simply gone, under a message saying something went wrong.
 *
 * The version that shipped named three codes. `notConnectedToInternet` fires
 * only in aeroplane mode; the connections this product actually has to survive
 * — hotel wifi, a captive portal, a phone abroad with roaming off — produce
 * every other code in this file.
 */
final class TransportFailureTests: XCTestCase {
    private func failure(_ code: URLError.Code) -> APIError {
        URLSessionTransport.failure(for: URLError(code))
    }

    func testTheConnectionsThisProductHasToSurviveCountAsOffline() {
        let unreachable: [URLError.Code] = [
            .notConnectedToInternet,
            .networkConnectionLost,
            .dataNotAllowed,
            // A patient abroad with roaming switched off. The whole product.
            .internationalRoamingOff,
            // Hotel and airport wifi, before and after the captive portal.
            .cannotFindHost,
            .dnsLookupFailed,
            .cannotConnectToHost,
            .secureConnectionFailed,
            .serverCertificateUntrusted,
        ]

        for code in unreachable {
            XCTAssertTrue(
                failure(code).isConnectivity,
                "\(code) must reach the offline path, or the write is lost"
            )
        }
    }

    func testATimeoutIsItsOwnThing() {
        XCTAssertEqual(failure(.timedOut), .timedOut)
        XCTAssertTrue(failure(.timedOut).isConnectivity)
    }

    /// Whatever the code, a `URLError` means the request did not come back
    /// with an answer — so the default is the safe one.
    func testAnUnrecognisedCodeStillReachesTheOfflinePath() {
        XCTAssertTrue(failure(.unknown).isConnectivity)
        XCTAssertTrue(failure(.badServerResponse).isConnectivity)
    }

    /// Except a cancellation, which is somebody navigating away. Queueing a
    /// second copy of the write for that would be inventing work.
    func testACancelledRequestIsNotAConnectionProblem() {
        XCTAssertFalse(failure(.cancelled).isConnectivity)
    }

    /// The offline story rests on failing fast. `URLSession.shared` waits a
    /// minute, which on a connection that accepts the handshake and then goes
    /// quiet is a minute of frozen screen.
    func testTheSessionGivesUpBeforeThePatientDoes() {
        let session = URLSessionTransport.configured()

        XCTAssertLessThanOrEqual(session.configuration.timeoutIntervalForRequest, 20)
        XCTAssertNil(
            session.configuration.urlCache,
            "a second copy of clinical data with nobody's rules on it"
        )
    }
}

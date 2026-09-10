import XCTest
@testable import KlinikApp

/**
 * The device lock, and the case it used to miss (T7.2).
 *
 * It only ever guarded a cold launch: unlock once in the morning and the phone
 * was open all day — which is precisely the handset-left-on-a-ward-desk the
 * lock exists for, because a phone left on a desk has been backgrounded, not
 * rebooted.
 */
@MainActor
final class BiometricLockTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suite: String!

    override func setUp() {
        super.setUp()
        suite = "lock-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    /// A clock the test moves by hand: a lock tested with a real one is a lock
    /// tested by waiting.
    private final class Clock: @unchecked Sendable {
        var now = Date(timeIntervalSince1970: 1_000_000)
    }

    private func lock(enabled: Bool, clock: Clock) -> BiometricLock {
        defaults.set(enabled, forKey: "xyz.klinik.biometricLock")

        return BiometricLock(defaults: defaults, now: { clock.now })
    }

    func testLocksAgainAfterLongEnoughAway() {
        let clock = Clock()
        let sut = lock(enabled: true, clock: clock)
        sut.setEnabled(true)

        // Somebody has already unlocked it this session.
        sut.setEnabled(false)
        sut.setEnabled(true)
        XCTAssertFalse(sut.isLocked)

        sut.wentAway()
        clock.now += BiometricLock.grace + 1
        sut.cameBack()

        XCTAssertTrue(sut.isLocked)
    }

    /// The document picker, the camera and a preview all put the app behind
    /// something. Demanding a face scan on the way back from choosing a
    /// photograph is how people turn the lock off.
    func testStaysUnlockedAfterAShortTrip() {
        let clock = Clock()
        let sut = lock(enabled: true, clock: clock)
        sut.setEnabled(false)
        sut.setEnabled(true)

        sut.wentAway()
        clock.now += 5
        sut.cameBack()

        XCTAssertFalse(sut.isLocked)
    }

    func testDoesNothingWhenTheLockIsOff() {
        let clock = Clock()
        let sut = lock(enabled: false, clock: clock)

        sut.wentAway()
        clock.now += BiometricLock.grace * 10
        sut.cameBack()

        XCTAssertFalse(sut.isLocked)
    }

    /// Coming back without having gone away is a scene phase change the app
    /// makes on its own, and it must not lock anybody out.
    func testComingBackWithoutHavingLeftChangesNothing() {
        let clock = Clock()
        let sut = lock(enabled: true, clock: clock)
        sut.setEnabled(false)
        sut.setEnabled(true)

        sut.cameBack()

        XCTAssertFalse(sut.isLocked)
    }

    func testTurningItOffForgetsThatTheAppWasAway() {
        let clock = Clock()
        let sut = lock(enabled: true, clock: clock)
        sut.setEnabled(false)
        sut.setEnabled(true)

        sut.wentAway()
        sut.setEnabled(false)
        clock.now += BiometricLock.grace * 10
        sut.cameBack()

        XCTAssertFalse(sut.isLocked)
    }

    /// A cold launch with the lock on is locked, which is what it always did.
    func testStartsLockedWhenEnabled() {
        let sut = lock(enabled: true, clock: Clock())

        XCTAssertTrue(sut.isLocked)
    }
}

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
    /// A clock the test moves by hand: a lock tested with a real one is a lock
    /// tested by waiting.
    private final class Clock: @unchecked Sendable {
        var now = Date(timeIntervalSince1970: 1_000_000)
    }

    /**
     * Its own defaults, made inside the test rather than in `setUp`.
     *
     * `setUp` and `tearDown` are nonisolated overrides, and this class is
     * `@MainActor`: touching a stored property from them compiles on the
     * newer toolchain here and fails on CI's. See docs/KATKI-KURALLARI.md.
     */
    private func store() -> UserDefaults {
        UserDefaults(suiteName: "lock-tests-\(UUID().uuidString)")!
    }

    private func lock(enabled: Bool, clock: Clock, in defaults: UserDefaults) -> BiometricLock {
        defaults.set(enabled, forKey: "xyz.klinik.biometricLock")

        return BiometricLock(defaults: defaults, now: { clock.now })
    }

    func testLocksAgainAfterLongEnoughAway() {
        let clock = Clock()
        let sut = lock(enabled: true, clock: clock, in: store())
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
        let sut = lock(enabled: true, clock: clock, in: store())
        sut.setEnabled(false)
        sut.setEnabled(true)

        sut.wentAway()
        clock.now += 5
        sut.cameBack()

        XCTAssertFalse(sut.isLocked)
    }

    func testDoesNothingWhenTheLockIsOff() {
        let clock = Clock()
        let sut = lock(enabled: false, clock: clock, in: store())

        sut.wentAway()
        clock.now += BiometricLock.grace * 10
        sut.cameBack()

        XCTAssertFalse(sut.isLocked)
    }

    /// Coming back without having gone away is a scene phase change the app
    /// makes on its own, and it must not lock anybody out.
    func testComingBackWithoutHavingLeftChangesNothing() {
        let clock = Clock()
        let sut = lock(enabled: true, clock: clock, in: store())
        sut.setEnabled(false)
        sut.setEnabled(true)

        sut.cameBack()

        XCTAssertFalse(sut.isLocked)
    }

    func testTurningItOffForgetsThatTheAppWasAway() {
        let clock = Clock()
        let sut = lock(enabled: true, clock: clock, in: store())
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
        let sut = lock(enabled: true, clock: Clock(), in: store())

        XCTAssertTrue(sut.isLocked)
    }
}

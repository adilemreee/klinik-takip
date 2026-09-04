package xyz.klinik.shell

import xyz.klinik.network.Identity
import xyz.klinik.network.SessionState
import xyz.klinik.network.UserRole
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RootRouteTest {
    private fun identity(
        role: UserRole,
        patientId: String? = null,
        isStaff: Boolean = role != UserRole.PATIENT && role != UserRole.CAREGIVER,
    ) = Identity(
        userId = "01927f4e-0000-7000-8000-000000000001",
        role = role,
        displayName = "Test",
        patientId = patientId,
        isStaff = isStaff,
    )

    @Test
    fun `no session goes to sign in`() {
        assertEquals(
            RootRoute.SignIn,
            Root.route(RootInput(session = SessionState.SIGNED_OUT)),
        )
    }

    @Test
    fun `a lapsed session is told it lapsed`() {
        // Not SignIn: the user did nothing wrong and the screen should say so
        // rather than looking like their account vanished.
        assertEquals(
            RootRoute.SignInAgain,
            Root.route(RootInput(session = SessionState.EXPIRED)),
        )
    }

    @Test
    fun `a lapsed session says so even with an identity still in hand`() {
        // The identity is whoever was signed in last. An expired token cannot
        // fetch anything, so honouring it would show a home screen that fails
        // every request behind it.
        assertEquals(
            RootRoute.SignInAgain,
            Root.route(
                RootInput(
                    session = SessionState.EXPIRED,
                    identity = identity(UserRole.DOCTOR),
                ),
            ),
        )
    }

    @Test
    fun `identity in flight decides nothing`() {
        // Not SignIn. Guessing here flashes the login screen at somebody who is
        // already signed in, on every launch.
        assertNull(Root.route(RootInput(session = SessionState.SIGNED_IN)))
    }

    @Test
    fun `a patient lands on their own file`() {
        assertEquals(
            RootRoute.PatientHome("01927f4e-0000-7000-8000-0000000000aa"),
            Root.route(
                RootInput(
                    session = SessionState.SIGNED_IN,
                    identity = identity(
                        UserRole.PATIENT,
                        patientId = "01927f4e-0000-7000-8000-0000000000aa",
                    ),
                ),
            ),
        )
    }

    @Test
    fun `a patient with no file linked yet still reaches the patient home`() {
        // An invitation creates the account before the file is linked. Sending
        // them anywhere else would strand somebody mid-onboarding.
        assertEquals(
            RootRoute.PatientHome(null),
            Root.route(
                RootInput(
                    session = SessionState.SIGNED_IN,
                    identity = identity(UserRole.PATIENT, patientId = null),
                ),
            ),
        )
    }

    @Test
    fun `every staff role reaches the staff home, carrying its role`() {
        val staff = listOf(
            UserRole.SUPER_ADMIN,
            UserRole.DOCTOR,
            UserRole.NURSE,
            UserRole.COORDINATOR,
            UserRole.FINANCE,
        )

        for (role in staff) {
            assertEquals(
                RootRoute.StaffHome(role),
                Root.route(
                    RootInput(
                        session = SessionState.SIGNED_IN,
                        identity = identity(role),
                    ),
                ),
                "$role should reach the staff home",
            )
        }
    }

    @Test
    fun `a caregiver is told there is no screen for them`() {
        // Section 2 gives a caregiver limited access to somebody else's file
        // and this app has no screen for it. Saying so is honest; routing them
        // into a patient home that is not theirs would not be.
        assertEquals(
            RootRoute.Unsupported(UserRole.CAREGIVER),
            Root.route(
                RootInput(
                    session = SessionState.SIGNED_IN,
                    identity = identity(UserRole.CAREGIVER),
                ),
            ),
        )
    }

    @Test
    fun `a caregiver carrying a patient id is still unsupported`() {
        // The id is the file they assist with, not one they own. Treating it as
        // their own would show them somebody else's file as if it were theirs
        // — the exact confusion the route exists to prevent.
        assertEquals(
            RootRoute.Unsupported(UserRole.CAREGIVER),
            Root.route(
                RootInput(
                    session = SessionState.SIGNED_IN,
                    identity = identity(
                        UserRole.CAREGIVER,
                        patientId = "01927f4e-0000-7000-8000-0000000000bb",
                    ),
                ),
            ),
        )
    }

    @Test
    fun `the server's staff flag wins over the role name`() {
        // isStaff is the server's answer. If the two ever disagree the server
        // is the one that decides what the API will actually let through, so
        // the client follows it rather than re-deriving the rule.
        assertEquals(
            RootRoute.StaffHome(UserRole.PATIENT),
            Root.route(
                RootInput(
                    session = SessionState.SIGNED_IN,
                    identity = identity(UserRole.PATIENT, isStaff = true),
                ),
            ),
        )
    }

    @Test
    fun `a role the server considers non-staff never reaches the staff home`() {
        // The direction that matters for safety: nothing that is not staff may
        // land on the patient list.
        for (role in UserRole.entries) {
            val route = Root.route(
                RootInput(
                    session = SessionState.SIGNED_IN,
                    identity = identity(role, isStaff = false),
                ),
            )
            assertTrue(
                route !is RootRoute.StaffHome,
                "$role is not staff and must not reach the staff home",
            )
        }
    }

    @Test
    fun `every role has a display string key`() {
        // The home screen looks the role up in strings.xml by this key; a role
        // added later with no string shows a blank chip.
        val expected = setOf(
            "role_super_admin",
            "role_doctor",
            "role_nurse",
            "role_coordinator",
            "role_finance",
            "role_patient",
            "role_caregiver",
        )
        assertEquals(expected, UserRole.entries.map { it.stringKey }.toSet())
    }
}

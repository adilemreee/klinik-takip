/**
 * Machine-readable codes the mobile clients branch on.
 *
 * INVALID_CREDENTIALS is deliberately returned for both an unknown account and
 * a wrong password: distinguishing them turns the login form into an account
 * enumeration oracle, which for a clinic means confirming that a named person
 * is a patient here.
 */
export const AuthError = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  MFA_SETUP_REQUIRED: 'MFA_SETUP_REQUIRED',
  INVITATION_INVALID: 'INVITATION_INVALID',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_ATTEMPTS_EXCEEDED: 'INVITATION_ATTEMPTS_EXCEEDED',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',
} as const;

export type AuthErrorCode = (typeof AuthError)[keyof typeof AuthError];

/** Roles that must carry a second factor (spec section 2). */
export const STAFF_ROLES = ['SUPER_ADMIN', 'DOCTOR', 'NURSE', 'COORDINATOR', 'FINANCE'] as const;

export function isStaffRole(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

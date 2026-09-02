import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares what a route needs. All listed permissions must be held — an
 * endpoint that reads a patient file *and* their finances legitimately needs
 * both, and "any of" would quietly widen access.
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSION_KEY = 'anyPermission';

/**
 * Passes when the caller holds **any one** of the listed permissions.
 *
 * Distinct from @RequirePermissions, which requires all of them. Both exist
 * because both are real: writing a clinical note needs medical.write *and*
 * patients.read, while a conversation endpoint serves a nurse holding
 * messages.read and a patient holding self.message, and no one holds both.
 *
 * Written after a set of messaging endpoints was declared with
 * @RequirePermissions('messages.read', 'self.message') and could therefore be
 * called by nobody at all.
 */
export const RequireAnyPermission = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);

import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares what a route needs. All listed permissions must be held — an
 * endpoint that reads a patient file *and* their finances legitimately needs
 * both, and "any of" would quietly widen access.
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

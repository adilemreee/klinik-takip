import { ConflictException } from '@nestjs/common';

/**
 * Raised when a write carries a version the server has already moved past.
 *
 * Spec M15: clinical data is never silently overwritten. The body carries the
 * server's current record so the client can show both sides and let a human
 * decide — a conflict the user cannot see is a conflict resolved by whoever
 * happened to save last.
 */
export class VersionConflictException extends ConflictException {
  constructor(
    entityType: string,
    expectedVersion: number,
    currentVersion: number,
    current: unknown,
  ) {
    super({
      statusCode: 409,
      // A code rather than prose: the clients branch on it.
      message: 'VERSION_CONFLICT',
      entityType,
      expectedVersion,
      currentVersion,
      current,
    });
  }
}

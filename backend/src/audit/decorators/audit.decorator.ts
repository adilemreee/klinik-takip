import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

export const AUDIT_KEY = 'auditMetadata';

export interface AuditMetadata {
  /** Table or resource name, e.g. 'patients'. */
  entityType: string;
  action: AuditAction;
  /** Route parameter holding the record id, e.g. 'id' in /patients/:id. */
  entityIdParam?: string;
  /** Route parameter holding the patient id, when it differs from entityIdParam. */
  patientIdParam?: string;
}

/**
 * Marks a read endpoint for automatic audit logging.
 *
 * Only reads. Mutations audit themselves inside their own transaction, because
 * an audit row written separately from the change it describes can end up
 * recording something that did not happen — or missing something that did.
 */
export const Audit = (metadata: AuditMetadata): MethodDecorator =>
  SetMetadata(AUDIT_KEY, metadata);

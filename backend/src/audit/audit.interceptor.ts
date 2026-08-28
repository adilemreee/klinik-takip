import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditAction } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import type { RequestWithUser } from '../auth/decorators/current-user.decorator';
import { AUDIT_KEY, AuditMetadata } from './decorators/audit.decorator';
import { AuditService } from './audit.service';

/**
 * Records reads declared with @Audit.
 *
 * Spec section 13 requires logging who *looked* at a record, not only who
 * changed it. With health data that is the more common form of misuse: a
 * curious staff member browsing a file they have no business in leaves no other
 * trace.
 *
 * Only successful responses are recorded — a request rejected by a guard never
 * reached the data, and logging it as a read would make the trail lie.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditMetadata | undefined>(AUDIT_KEY, context.getHandler());

    if (!metadata || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    return next.handle().pipe(
      tap({
        next: () => {
          const params = request.params as Record<string, string | undefined>;

          void this.audit.record({
            actorId: request.user?.id,
            actorRole: request.user?.role,
            action: metadata.action ?? AuditAction.READ,
            entityType: metadata.entityType,
            entityId: metadata.entityIdParam ? params[metadata.entityIdParam] : undefined,
            patientId: metadata.patientIdParam
              ? params[metadata.patientIdParam]
              : metadata.entityType === 'patients' && metadata.entityIdParam
                ? params[metadata.entityIdParam]
                : undefined,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            requestId: typeof request.id === 'string' ? request.id : undefined,
          });
        },
      }),
    );
  }
}

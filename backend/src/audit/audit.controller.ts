import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { AnomalyDto, AuditPageDto } from './dto/audit-response.dto';
import { AuditAction, Prisma } from '@prisma/client';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { Anomaly, AuditAnomalyService } from './audit-anomaly.service';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { PrismaService } from '../infra/prisma.service';

const DEFAULT_LIMIT = 50;

interface AuditPage {
  items: unknown[];
  nextCursor: string | null;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly anomalies: AuditAnomalyService,
  ) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Filterable audit trail (spec section 13)' })
  @ApiOkResponse({ type: AuditPageDto })
  @ApiStandardErrors({ notFound: false })
  async list(
    @Query() query: AuditQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuditPage> {
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.AuditLogWhereInput = {
      actorId: query.actorId,
      actorRole: query.actorRole,
      action: query.action,
      patientId: query.patientId,
      entityType: query.entityType,
      createdAt:
        query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
    };

    // Ids are UUIDv7, so ordering by id is ordering by time — one index, no
    // secondary sort key, and a stable cursor even when rows share a timestamp.
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // Reading the trail is itself a sensitive action, so it goes into the trail.
    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.READ,
      entityType: 'audit_logs',
      patientId: query.patientId,
      after: { filters: { ...query, cursor: undefined }, returned: items.length },
    });

    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  @Get('anomalies')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Suspicious access patterns in the given window' })
  @ApiOkResponse({ type: [AnomalyDto] })
  @ApiStandardErrors({ notFound: false })
  async detectAnomalies(
    @Query('hours') hours: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Anomaly[]> {
    const windowHours = Math.min(Math.max(Number(hours) || 24, 1), 24 * 30);
    const start = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const found = await this.anomalies.detect(start);

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.READ,
      entityType: 'audit_anomalies',
      after: { windowHours, found: found.length },
    });

    return found;
  }
}

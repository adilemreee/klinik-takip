import { Injectable, Logger } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

const CACHE_PREFIX = 'perms:';

/**
 * Cache lifetime is a backstop, not the revocation mechanism.
 *
 * Every write that changes someone's permissions invalidates their entry
 * explicitly, so a revocation takes effect immediately. The TTL only bounds how
 * long a stale entry could survive a missed invalidation — five minutes is
 * short enough to matter and long enough to be worth caching at all.
 */
const CACHE_TTL_SECONDS = 300;

/**
 * Effective permissions for a user: the role matrix, plus per-user overrides.
 *
 * Authorisation is data, not code (spec section 2) — the doctor can change who
 * may do what without a deploy. That means every check is a database read, so
 * it is cached.
 */
@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getEffectivePermissions(userId: string, role: Role): Promise<Set<string>> {
    const cached = await this.readCache(userId);
    if (cached) {
      return cached;
    }

    const [rolePermissions, overrides] = await Promise.all([
      this.prisma.rolePermission.findMany({ where: { role }, select: { permissionCode: true } }),
      this.prisma.userPermission.findMany({
        where: { userId },
        select: { permissionCode: true, granted: true },
      }),
    ]);

    const effective = new Set(rolePermissions.map((p) => p.permissionCode));

    // Overrides are applied after the role grants, so `granted: false` can take
    // away something the role would otherwise carry.
    for (const override of overrides) {
      if (override.granted) {
        effective.add(override.permissionCode);
      } else {
        effective.delete(override.permissionCode);
      }
    }

    await this.writeCache(userId, effective);

    return effective;
  }

  async has(userId: string, role: Role, permission: string): Promise<boolean> {
    return (await this.getEffectivePermissions(userId, role)).has(permission);
  }

  /**
   * The reverse question: who holds this permission?
   *
   * Asked by the escalation ladder, which needs a floor under it — the people
   * who may receive an emergency, when the patient in trouble has no care team
   * assigned. Uncached deliberately: it is asked once per alarm, and a stale
   * answer here means alerting someone whose access was revoked this morning.
   *
   * Overrides are applied the same way as in `getEffectivePermissions`, in the
   * same order, because two places computing "does this person have it" from
   * the same tables must never be able to disagree.
   */
  async usersWith(permission: string): Promise<string[]> {
    const [roles, overrides] = await Promise.all([
      this.prisma.rolePermission.findMany({
        where: { permissionCode: permission },
        select: { role: true },
      }),
      this.prisma.userPermission.findMany({
        where: { permissionCode: permission },
        select: { userId: true, granted: true },
      }),
    ]);

    const byRole = await this.prisma.user.findMany({
      where: { role: { in: roles.map((r) => r.role) }, status: UserStatus.ACTIVE },
      select: { id: true },
    });

    const holders = new Set(byRole.map((user) => user.id));

    for (const override of overrides) {
      if (override.granted) holders.add(override.userId);
      else holders.delete(override.userId);
    }

    if (holders.size === 0) return [];

    // A grant override can name a user who has since been suspended, so the
    // active check is applied to the whole set rather than only to the role
    // branch.
    const active = await this.prisma.user.findMany({
      where: { id: { in: [...holders] }, status: UserStatus.ACTIVE },
      select: { id: true },
    });

    return active.map((user) => user.id);
  }

  /** Called by every write that changes what a user may do. */
  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.client.del(CACHE_PREFIX + userId);
    } catch (error) {
      // A cache that cannot be cleared is worse than no cache: fail loudly
      // rather than leave a revoked permission live for the TTL.
      this.logger.error(`Failed to invalidate permissions for ${userId}: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Used when the role matrix itself changes, which affects everyone at once.
   */
  async invalidateAll(): Promise<void> {
    const keys = await this.redis.client.keys(`${CACHE_PREFIX}*`);

    if (keys.length > 0) {
      await this.redis.client.del(...keys);
    }

    this.logger.log(`Invalidated ${keys.length} cached permission sets`);
  }

  private async readCache(userId: string): Promise<Set<string> | null> {
    try {
      const raw = await this.redis.client.get(CACHE_PREFIX + userId);
      if (raw === null) {
        return null;
      }

      return new Set(JSON.parse(raw) as string[]);
    } catch (error) {
      // Redis being down must not lock every user out; fall through to the
      // database, which is the source of truth anyway.
      this.logger.warn(`Permission cache read failed: ${String(error)}`);
      return null;
    }
  }

  private async writeCache(userId: string, permissions: Set<string>): Promise<void> {
    try {
      await this.redis.client.set(
        CACHE_PREFIX + userId,
        JSON.stringify([...permissions]),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Permission cache write failed: ${String(error)}`);
    }
  }
}

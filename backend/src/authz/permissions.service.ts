import { Injectable } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ROLE_PERMISSIONS, rolesWith } from './role-permissions';

/**
 * What a user may do.
 *
 * This was a database read on every check — the role matrix plus per-user
 * overrides — cached in Redis for five minutes and invalidated by hand from
 * every write that could change someone's access. Authorisation was data, so
 * that the clinic could change who may do what without a deploy.
 *
 * Nobody ever did. The override table was empty and the matrix was seeded from
 * a constant, so what the machinery bought was a cache to keep coherent and a
 * revocation path to get right, in exchange for configurability that was never
 * used. It is a lookup in `ROLE_PERMISSIONS` now: no read, no cache, no
 * invalidation, and no way for two callers to disagree about what somebody may
 * do.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  getEffectivePermissions(role: Role): ReadonlySet<string> {
    return ROLE_PERMISSIONS[role] ?? new Set<string>();
  }

  has(role: Role, permission: string): boolean {
    return this.getEffectivePermissions(role).has(permission);
  }

  /**
   * Who to wake for something that needs a person.
   *
   * Still a database read, because the answer is a list of users rather than a
   * list of permissions, and it is deliberately uncached: it is asked once per
   * alarm, and a stale answer means alerting somebody whose account was
   * closed this morning.
   */
  async usersWith(permission: string): Promise<string[]> {
    const roles = rolesWith(permission);

    if (roles.length === 0) return [];

    const holders = await this.prisma.user.findMany({
      where: { role: { in: roles }, status: UserStatus.ACTIVE },
      select: { id: true },
    });

    return holders.map((user) => user.id);
  }
}

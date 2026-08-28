import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionsService } from '../permissions.service';

/**
 * Enforces @RequirePermissions. Runs after JwtAuthGuard, so request.user is set.
 *
 * A route with no declaration passes: authentication alone is the requirement
 * there. Data-level scoping (which patients a nurse may see) is a separate
 * check — see PatientAccessService.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const held = await this.permissions.getEffectivePermissions(user.id, user.role);
    const missing = required.filter((permission) => !held.has(permission));

    if (missing.length > 0) {
      // Names the permission rather than the data: telling the caller which
      // record they were denied would itself leak that the record exists.
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }

    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_MFA_SETUP_KEY } from '../decorators/allow-mfa-setup.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestWithUser } from '../decorators/current-user.decorator';
import { TokenService } from '../token.service';

/**
 * Global guard: every route requires a valid access token unless explicitly
 * marked @Public.
 *
 * It also checks that the session family is still active. An access token stays
 * cryptographically valid until it expires, so without this check "sign out
 * this device" would not take effect for up to fifteen minutes — long enough to
 * matter on a stolen phone.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const payload = await this.tokens.verifyAccessToken(token);

    if (payload.scp === 'mfa_setup') {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_SETUP_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (!allowed) {
        throw new UnauthorizedException('This token may only be used to enrol two-factor authentication');
      }

      // No session family exists yet, so there is nothing to check for revocation.
      request.user = { id: payload.sub, role: payload.role, familyId: payload.fid };
      return true;
    }

    if (!(await this.tokens.isFamilyActive(payload.fid))) {
      throw new UnauthorizedException('Session has been revoked');
    }

    request.user = { id: payload.sub, role: payload.role, familyId: payload.fid };

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }

    return header.slice('Bearer '.length).trim() || undefined;
  }
}

import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  role: Role;
  /** Session family, so a handler can act on the caller's own device. */
  familyId: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (!request.user) {
      // Reachable only if a handler using this decorator is also marked
      // @Public — a wiring mistake, not a runtime condition.
      throw new Error('CurrentUser used on a route without authentication');
    }

    return request.user;
  },
);

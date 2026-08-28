import { SetMetadata } from '@nestjs/common';

export const ALLOW_MFA_SETUP_KEY = 'allowMfaSetup';

/**
 * Lets a route accept the narrowly scoped token issued when a staff member has
 * no second factor yet. Only the enrolment endpoints carry this; everywhere
 * else the token is rejected outright.
 */
export const AllowMfaSetup = (): MethodDecorator => SetMetadata(ALLOW_MFA_SETUP_KEY, true);

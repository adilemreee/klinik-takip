import { applyDecorators } from '@nestjs/common';
import { ApiBadRequestResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * The failures every authenticated endpoint can return.
 *
 * Declared once rather than repeated per route: an undocumented 403 is a
 * generated client that throws where it should branch.
 *
 * 404 is included deliberately on scoped resources — a patient outside the
 * caller's scope reports "not found", not "forbidden", so clients must treat
 * the two as one case (see docs/YETKILENDIRME.md).
 */
export const ApiStandardErrors = (options: { notFound?: boolean } = {}): MethodDecorator => {
  const decorators = [
    ApiBadRequestResponse({ description: 'Validation failed', type: ErrorResponseDto }),
    ApiUnauthorizedResponse({
      description: 'Missing, invalid or revoked token',
      type: ErrorResponseDto,
    }),
    ApiForbiddenResponse({ description: 'Authenticated but lacking the permission', type: ErrorResponseDto }),
  ];

  if (options.notFound !== false) {
    decorators.push(
      ApiNotFoundResponse({
        description: 'Not found, or outside the caller’s scope — deliberately indistinguishable',
        type: ErrorResponseDto,
      }),
    );
  }

  return applyDecorators(...decorators);
};

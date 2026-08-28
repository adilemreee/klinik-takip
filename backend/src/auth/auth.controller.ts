import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService, SessionSummary } from './auth.service';
import { AuthError } from './auth.errors';
import { AllowMfaSetup } from './decorators/allow-mfa-setup.decorator';
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  CreateInvitationDto,
  LoginDto,
  RefreshDto,
  TotpCodeDto,
} from './dto/auth.dto';
import { CreatedInvitation, InvitationService } from './invitation.service';
import { DeviceContext, IssuedTokens, TokenService } from './token.service';

interface LoginResponse extends Partial<IssuedTokens> {
  status: 'OK' | 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';
  /** Present only with MFA_SETUP_REQUIRED. */
  setupToken?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly invitations: InvitationService,
  ) {}

  @Public()
  // Far tighter than the global limit: this is the endpoint an attacker
  // hammers, and account lockout alone would let them lock out real users.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with password and, where enabled, a TOTP code' })
  async login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResponse> {
    const result = await this.auth.login(
      dto.identifier,
      dto.password,
      dto.totpCode,
      this.deviceContext(request, dto.deviceName, dto.platform),
    );

    if (result.pending) {
      return { status: result.pending, setupToken: result.setupToken };
    }

    return { status: 'OK', ...result.tokens };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token; the old one is consumed' })
  async refresh(@Body() dto: RefreshDto, @Req() request: Request): Promise<IssuedTokens> {
    return this.tokens.rotate(dto.refreshToken, this.deviceContext(request));
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out this device' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.tokens.revokeFamily(user.familyId);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out every device' })
  async logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.tokens.revokeAllForUser(user.id);
  }

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({ summary: 'List active devices (spec section 2)' })
  async sessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionSummary[]> {
    return this.auth.listSessions(user.id, user.familyId);
  }

  @ApiBearerAuth()
  @Delete('sessions/:familyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke one device remotely' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('familyId') familyId: string,
  ): Promise<void> {
    // Scoped to the caller's own sessions: without this check any authenticated
    // user could sign out anyone else by guessing a family id.
    const own = await this.auth.listSessions(user.id, user.familyId);

    if (!own.some((session) => session.familyId === familyId)) {
      throw new UnauthorizedException('Not your session');
    }

    await this.tokens.revokeFamily(familyId);
  }

  @ApiBearerAuth()
  @AllowMfaSetup()
  @Post('2fa/setup')
  @ApiOperation({ summary: 'Begin TOTP enrolment; returns the secret and otpauth URI' })
  async setupTotp(@CurrentUser() user: AuthenticatedUser): Promise<{ secret: string; uri: string }> {
    return this.auth.beginTotpEnrolment(user.id);
  }

  @ApiBearerAuth()
  @AllowMfaSetup()
  @Post('2fa/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm enrolment with a generated code' })
  async confirmTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TotpCodeDto,
  ): Promise<void> {
    await this.auth.confirmTotpEnrolment(user.id, dto.code);
  }

  @ApiBearerAuth()
  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disable TOTP — patients only; mandatory for staff' })
  async disableTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TotpCodeDto,
  ): Promise<void> {
    await this.auth.disableTotp(user.id, dto.code);
  }

  @ApiBearerAuth()
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password; signs out every device' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  /**
   * Invitation creation is permission-checked in T1.3; for now it requires a
   * staff session. The code is returned once, for the notification worker.
   */
  @ApiBearerAuth()
  @Post('invitations')
  @ApiOperation({ summary: 'Invite a staff member or a patient' })
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ): Promise<CreatedInvitation> {
    return this.invitations.create(user.id, dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invitations/accept')
  @ApiOperation({ summary: 'Redeem an invitation code and set a password' })
  async acceptInvitation(@Body() dto: AcceptInvitationDto): Promise<{ userId: string }> {
    if (!dto.identifier) {
      throw new UnauthorizedException(AuthError.INVITATION_INVALID);
    }

    return this.invitations.accept(dto.identifier, dto.code, dto.password);
  }

  private deviceContext(request: Request, deviceName?: string, platform?: string): DeviceContext {
    return {
      deviceName,
      platform,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }
}

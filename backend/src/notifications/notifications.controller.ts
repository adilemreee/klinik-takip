import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Notification, NotificationPreference } from '@prisma/client';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { PrismaService } from '../infra/prisma.service';
import {
  NotificationDto,
  PreferenceDto,
  RegisterPushTokenDto,
  UpdatePreferenceDto,
} from './dto/notification.dto';

/**
 * Everyone's own notification settings.
 *
 * No permission beyond being signed in: these are the caller's own device and
 * the caller's own preferences, and gating them on a clinical permission would
 * mean a patient could not turn off their own alerts.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class MyNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers a device for push.
   *
   * Upserted on the token, and any other user's claim on it is released: a
   * phone handed to someone else, or a reinstall that reuses a token, must not
   * keep delivering one person's clinical notifications to another.
   */
  @Post('tokens')
  @ApiOperation({ summary: 'Register this device for push' })
  @ApiCreatedResponse({ schema: { properties: { registered: { type: 'boolean' } } } })
  @ApiStandardErrors()
  async registerToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<{ registered: boolean }> {
    await this.prisma.pushToken.upsert({
      where: { token: dto.token },
      create: {
        userId: user.id,
        token: dto.token,
        platform: dto.platform,
        deviceId: dto.deviceId,
        lastUsedAt: new Date(),
      },
      update: {
        userId: user.id,
        platform: dto.platform,
        deviceId: dto.deviceId,
        isActive: true,
        lastUsedAt: new Date(),
      },
    });

    return { registered: true };
  }

  /** On sign-out, so the device stops receiving what it may no longer see. */
  @Delete('tokens')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop sending push to this device' })
  @ApiNoContentResponse()
  @ApiStandardErrors()
  async revokeToken(
    @CurrentUser() user: AuthenticatedUser,
    @Query('token') token: string,
  ): Promise<void> {
    await this.prisma.pushToken.updateMany({
      where: { token, userId: user.id },
      data: { isActive: false },
    });
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Your notification preferences' })
  @ApiOkResponse({ type: [PreferenceDto] })
  @ApiStandardErrors()
  async preferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where: { userId: user.id },
      orderBy: [{ type: 'asc' }, { channel: 'asc' }],
    });
  }

  /**
   * Sets one preference.
   *
   * Absent means enabled: a patient who has never opened this screen still gets
   * told their results are ready. Only a row that says `enabled: false` silences
   * anything.
   */
  @Put('preferences')
  @ApiOperation({ summary: 'Turn a notification type on or off for a channel' })
  @ApiOkResponse({ type: PreferenceDto })
  @ApiStandardErrors()
  async setPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePreferenceDto,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_type_channel: { userId: user.id, type: dto.type, channel: dto.channel },
      },
      create: {
        userId: user.id,
        type: dto.type,
        channel: dto.channel,
        enabled: dto.enabled,
        quietHoursStart: dto.quietHoursStart,
        quietHoursEnd: dto.quietHoursEnd,
        timezone: dto.timezone ?? 'Europe/Istanbul',
      },
      update: {
        enabled: dto.enabled,
        quietHoursStart: dto.quietHoursStart ?? null,
        quietHoursEnd: dto.quietHoursEnd ?? null,
        timezone: dto.timezone ?? 'Europe/Istanbul',
      },
    });
  }

  /**
   * What has been sent to the caller, newest first.
   *
   * Includes the attempts that failed. A patient who was never reached should
   * be able to see that the clinic tried — and the clinic should be able to see
   * it too, which is the point of logging every send (spec M6).
   */
  @Get()
  @ApiOperation({ summary: 'Your notifications, including failed attempts' })
  @ApiOkResponse({ type: [NotificationDto] })
  @ApiStandardErrors()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark your notifications read' })
  @ApiOkResponse({ schema: { properties: { marked: { type: 'number' } } } })
  @ApiStandardErrors()
  async markRead(@CurrentUser() user: AuthenticatedUser): Promise<{ marked: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });

    return { marked: result.count };
  }
}

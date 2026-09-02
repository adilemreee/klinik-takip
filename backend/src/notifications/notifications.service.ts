import { Injectable, Logger } from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationPreference,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { inQuietHours } from './quiet-hours';
import { isKnownType, render, type NotificationType } from './templates';
import type { NotificationSender } from './senders';

export interface DispatchInput {
  userId: string;
  type: NotificationType;
  /** Deep-link payload the clients match to a screen. */
  data?: Record<string, unknown>;
  /** Held until this moment rather than sent now. */
  scheduledFor?: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly senders = new Map<NotificationChannel, NotificationSender>();

  constructor(private readonly prisma: PrismaService) {}

  /** Registered at boot; a channel with no sender is simply never tried. */
  registerSender(sender: NotificationSender): void {
    this.senders.set(sender.channel, sender);
  }

  /**
   * Queues a notification for someone.
   *
   * Written to the database first and delivered later, because delivery is
   * where things fail: a row that exists is one that can be retried, reported
   * on, and shown in the app even when every outside channel is down.
   */
  async dispatch(input: DispatchInput): Promise<Notification | null> {
    if (!isKnownType(input.type)) {
      // Narrowed to never by the guard, so widened back for the message: the
      // point of logging it is that something passed a type nobody defined.
      this.logger.error(`Refusing to send an unknown notification type: ${String(input.type)}`);
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, patient: { select: { preferredLanguage: true } } },
    });

    if (!user) return null;

    const rendered = render(input.type, user.patient?.preferredLanguage);
    if (!rendered) return null;

    const preference = await this.preferenceFor(input.userId, input.type, NotificationChannel.PUSH);

    if (preference && !preference.enabled) {
      // Asked not to be told this way. Not an error, and not a failure to log
      // as one.
      return null;
    }

    const now = new Date();
    const quiet = preference ? inQuietHours(preference, now) : false;

    // Quiet hours delay, they do not cancel. A notification dropped for being
    // inconvenient is one the patient never learns existed.
    const scheduledFor =
      input.scheduledFor ??
      (quiet && !rendered.urgent ? this.endOfQuietHours(preference!, now) : null);

    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: rendered.title,
        body: rendered.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        actions: rendered.actions as unknown as Prisma.InputJsonValue,
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.PENDING,
        scheduledFor,
      },
    });
  }

  /**
   * Sends everything due, falling back a channel at a time.
   *
   * Each attempt is its own row, linked to the one it is standing in for, so
   * the chain is auditable after the fact (spec M6) rather than collapsed into
   * a single "eventually delivered".
   */
  async deliverDue(now = new Date()): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: {
        status: NotificationStatus.PENDING,
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
      },
      orderBy: { id: 'asc' },
      take: 200,
    });

    let delivered = 0;

    for (const notification of due) {
      if (await this.attempt(notification)) delivered += 1;
    }

    return delivered;
  }

  private async attempt(notification: Notification): Promise<boolean> {
    const addresses = await this.addressesFor(notification.userId, notification.channel);
    const sender = this.senders.get(notification.channel);

    if (!sender || addresses.length === 0) {
      await this.fail(
        notification,
        sender ? `No ${notification.channel} address on file` : `${notification.channel} is not configured`,
      );
      return false;
    }

    for (const address of addresses) {
      const result = await sender.send({
        channel: notification.channel,
        address,
        title: notification.title,
        body: notification.body,
        data: (notification.data as Record<string, unknown> | null) ?? undefined,
      });

      if (result.addressGone) {
        await this.retireToken(address);
      }

      if (result.delivered) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: NotificationStatus.SENT, sentAt: new Date() },
        });

        return true;
      }
    }

    await this.fail(notification, 'Every address for this channel refused the message');
    return false;
  }

  /**
   * Marks an attempt failed and opens the next link in the chain.
   *
   * The fallback row is created here rather than retried in place so the log
   * shows what was tried, in what order, and why each one stopped.
   */
  private async fail(notification: Notification, reason: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.FAILED, failureReason: reason.slice(0, 500) },
    });

    const next = this.nextChannel(notification);
    if (!next) return;

    const preference = await this.preferenceFor(
      notification.userId,
      notification.type as NotificationType,
      next,
    );

    // A channel someone switched off is not a fallback. Falling back onto it
    // would make "no SMS please" mean "SMS, but only when push fails".
    if (preference && !preference.enabled) return;

    await this.prisma.notification.create({
      data: {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
        actions: notification.actions ?? [],
        channel: next,
        status: NotificationStatus.PENDING,
        fallbackForId: notification.id,
      },
    });
  }

  /** The next channel in this type's chain, after the one that just failed. */
  private nextChannel(notification: Notification): NotificationChannel | null {
    const rendered = render(notification.type as NotificationType, null);
    if (!rendered) return null;

    const chain = [NotificationChannel.PUSH, ...rendered.fallback];
    const position = chain.indexOf(notification.channel);

    if (position < 0 || position + 1 >= chain.length) return null;

    return chain[position + 1] ?? null;
  }

  private async addressesFor(
    userId: string,
    channel: NotificationChannel,
  ): Promise<string[]> {
    if (channel === NotificationChannel.PUSH) {
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId, isActive: true },
        orderBy: { lastUsedAt: 'desc' },
      });

      return tokens.map((token) => token.token);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true },
    });

    if (channel === NotificationChannel.EMAIL) {
      return user?.email ? [user.email] : [];
    }

    if (channel === NotificationChannel.SMS) {
      return user?.phone ? [user.phone] : [];
    }

    return [];
  }

  /** A token the platform says is dead stops being used. */
  private async retireToken(token: string): Promise<void> {
    await this.prisma.pushToken
      .updateMany({ where: { token }, data: { isActive: false } })
      .catch(() => undefined);
  }

  private async preferenceFor(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<NotificationPreference | null> {
    return this.prisma.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type, channel } },
    });
  }

  /**
   * When the quiet period ends, so a held notification goes then rather than
   * at some arbitrary later sweep.
   */
  private endOfQuietHours(preference: NotificationPreference, from: Date): Date {
    const end = preference.quietHoursEnd;
    if (!end) return from;

    const [hours, minutes] = end.split(':').map(Number);
    const target = new Date(from);

    // Computed in UTC against the stored offset rather than with a calendar
    // library: the only question here is "the next time the local clock reads
    // 08:00", and stepping forward until it does is exact without one.
    for (let step = 0; step < 24 * 60; step += 5) {
      const candidate = new Date(from.getTime() + step * 60_000);
      const local = new Intl.DateTimeFormat('en-GB', {
        timeZone: preference.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(candidate);

      const [candidateHour, candidateMinute] = local.split(':').map(Number);

      if (candidateHour === (hours ?? 0) && Math.abs((candidateMinute ?? 0) - (minutes ?? 0)) < 5) {
        return candidate;
      }
    }

    return target;
  }
}

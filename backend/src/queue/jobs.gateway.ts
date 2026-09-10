import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Role } from '@prisma/client';
import type Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { Env } from '../config/env.schema';
import { RedisService } from '../infra/redis.service';
import { JOB_EVENTS_CHANNEL, parseJobEvent } from './job-events';

interface AccessTokenPayload {
  sub: string;
  role: Role;
  fid: string;
}

interface AuthenticatedSocket extends Socket {
  data: { user?: AuthenticatedUser };
}

/** One room per patient, so a socket only ever hears about files it may see. */
const room = (patientId: string): string => `patient:${patientId}`;

/**
 * Live job progress (spec M14).
 *
 * The work happens in the worker process, which has no socket server; the
 * sockets live in the API process, which runs no jobs. They meet on Redis: the
 * worker publishes each status change, this subscribes and hands it to the
 * room for that patient.
 *
 * Everything here is a courtesy on top of a correct screen. The clients poll
 * while anything is unsettled and read the truth from the database, so a
 * dropped event costs a few seconds, never a wrong answer. That is why nothing
 * in this file retries, buffers or replays: an announcement that arrives late
 * has already been overtaken by the read that made it unnecessary.
 *
 * It carries no authority of its own. Joining a room runs the same scope check
 * as the REST side, because a channel that authorised differently would be the
 * way around every rule the REST side enforces.
 */
@WebSocketGateway({ namespace: '/jobs', cors: false })
export class JobsGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsGateway.name);

  @WebSocketServer()
  private server!: Server;

  /**
   * Its own connection.
   *
   * A Redis client in subscriber mode accepts nothing else, so sharing the one
   * the permission cache uses would take the cache down with it.
   */
  private subscriber: Redis | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly redis: RedisService,
    private readonly access: PatientAccessService,
  ) {}

  onModuleInit(): void {
    /*
     * No Redis, no live events — and the screens carry on polling.
     *
     * True in the smoke tests, where the service is a stub, and true in an
     * environment where Redis has not come up yet. Either way this must not
     * take the application down: every screen this feeds reads the truth from
     * the database, and the announcement only saves them a few seconds.
     */
    const client = this.redis.client as Redis | undefined;

    if (typeof client?.duplicate !== 'function') {
      this.logger.warn('Job events unavailable: no Redis connection');
      return;
    }

    const subscriber = client.duplicate();

    subscriber.on('error', (error: Error) =>
      this.logger.warn(`Job event subscriber: ${error.message}`),
    );

    subscriber.on('message', (_channel: string, payload: string) => {
      const event = parseJobEvent(payload);

      // No patient means nothing to scope it to, and a job event broadcast to
      // everyone is a leak however small it looks.
      if (!event?.patientId) return;

      this.server?.to(room(event.patientId)).emit('job', event);
    });

    void subscriber.subscribe(JOB_EVENTS_CHANNEL).catch((error: unknown) => {
      // Said out loud rather than swallowed: the screens keep working, they
      // simply stop being live, and nothing else would say why.
      this.logger.warn(`Job events unavailable: ${String(error)}`);
    });

    this.subscriber = subscriber;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;

    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect();
    }

    this.subscriber = null;
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const token = this.tokenOf(client);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });

      client.data.user = { id: payload.sub, role: payload.role, familyId: payload.fid };
    } catch {
      // No detail on the wire: a client that cannot connect learns only that.
      client.disconnect(true);
    }
  }

  /**
   * Watches one patient's jobs.
   *
   * The scope check is the whole point. Without it a socket could join any
   * room by guessing an id and watch another patient's documents being
   * processed — quieter than reading them, and still a leak.
   */
  @SubscribeMessage('watch')
  async watch(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { patientId?: unknown },
  ): Promise<{ watching: boolean }> {
    const user = client.data.user;
    const patientId = typeof body?.patientId === 'string' ? body.patientId : null;

    if (!user || !patientId) return { watching: false };

    if (!(await this.access.canAccess(user, patientId))) {
      return { watching: false };
    }

    await client.join(room(patientId));

    return { watching: true };
  }

  @SubscribeMessage('unwatch')
  async unwatch(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { patientId?: unknown },
  ): Promise<{ watching: boolean }> {
    const patientId = typeof body?.patientId === 'string' ? body.patientId : null;

    if (patientId) {
      await client.leave(room(patientId));
    }

    return { watching: false };
  }

  /**
   * The token, from the handshake rather than a header.
   *
   * Not the query string: a URL ends up in proxy logs and browser history, and
   * an access token there outlives the connection that needed it.
   */
  private tokenOf(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown } | undefined;

    if (typeof auth?.token === 'string' && auth.token.length > 0) {
      return auth.token;
    }

    const header = client.handshake.headers.authorization;

    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }

    return null;
  }
}

import { Logger } from '@nestjs/common';
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
import type { Server, Socket } from 'socket.io';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Env } from '../config/env.schema';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';

interface AccessTokenPayload {
  sub: string;
  role: Role;
  fid: string;
}

/** A socket that has proved who it is. */
interface AuthenticatedSocket extends Socket {
  data: { user?: AuthenticatedUser };
}

/**
 * Live messaging (spec section 3.2: REST + WebSocket).
 *
 * The socket carries delivery and the typing indicator. It carries no
 * authority of its own: the same token, the same scope check and the same 404
 * rule apply here as on the REST side, because a channel that authorised
 * differently would be the way around every rule the REST side enforces.
 *
 * Messages are still *sent* over REST. A socket that drops mid-send leaves the
 * client unsure whether the message exists; a POST either returns an id or does
 * not.
 */
@WebSocketGateway({ namespace: '/messaging', cors: false })
export class MessagingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

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
      // No detail on the wire: a client that cannot connect learns only that,
      // which is all it needs and all it should have.
      client.disconnect(true);
    }
  }

  /**
   * Joins a conversation's room, after checking the caller may see it.
   *
   * The check is the whole point. Without it a socket could join any room by
   * guessing an id and receive another patient's messages in real time — a
   * quieter version of the leak the REST scope check exists to prevent.
   */
  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<{ joined: boolean }> {
    const user = client.data.user;
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;

    if (!user || !conversationId) return { joined: false };

    if (!(await this.maySee(user, conversationId))) {
      return { joined: false };
    }

    await client.join(room(conversationId));

    return { joined: true };
  }

  @SubscribeMessage('leave')
  async leave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<{ left: boolean }> {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!conversationId) return { left: false };

    await client.leave(room(conversationId));

    return { left: true };
  }

  /**
   * The typing indicator.
   *
   * Broadcast to the room and never stored: it is true for a few seconds and
   * then it is not, and a record of who was typing when is surveillance rather
   * than a feature.
   */
  @SubscribeMessage('typing')
  typing(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): void {
    const user = client.data.user;
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;

    if (!user || !conversationId) return;
    if (!client.rooms.has(room(conversationId))) return;

    client.to(room(conversationId)).emit('typing', { userId: user.id, conversationId });
  }

  /** Announces a message to everyone in the room. Called by the service. */
  emitMessage(conversationId: string, message: unknown): void {
    this.server?.to(room(conversationId)).emit('message', message);
  }

  /** Announces that messages were read, so the sender's ticks can change. */
  emitRead(conversationId: string, readerId: string): void {
    this.server?.to(room(conversationId)).emit('read', { conversationId, readerId });
  }

  private async maySee(user: AuthenticatedUser, conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { patientId: true },
    });

    if (!conversation) return false;

    return this.access.canAccess(user, conversation.patientId);
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

function room(conversationId: string): string {
  return `conversation:${conversationId}`;
}

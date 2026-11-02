import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../auth/rbac';
import { mintWsTicket } from '../auth/tgt';
import { env } from '../config/env';

interface WsTicketBody {
  streamType: 'dag_updates' | 'terminal_feed' | 'active_logs';
  taskId?: string | null;
}

const WsTicketBodySchema = Type.Object({
  streamType: Type.Union([
    Type.Literal('dag_updates'),
    Type.Literal('terminal_feed'),
    Type.Literal('active_logs'),
  ]),
  taskId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export async function telemetryRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/telemetry/ws-ticket
  fastify.post(
    '/ws-ticket',
    {
      preHandler: requirePermission('ws_ticket_read'),
      schema: {
        body: WsTicketBodySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = request.body as WsTicketBody;

      const minted = await mintWsTicket({
        userId: user.userId,
        workspaceId: user.currentWorkspaceId,
        role: user.role,
        streamType: body.streamType,
        taskId: body.taskId ?? undefined,
      });

      const wsUrl = `ws://localhost:${env.PORT_CONTROL}/stream?ticket=${minted.ticket}`;

      return reply.status(200).send({
        ticket: minted.ticket,
        ttlSeconds: minted.ttlSeconds,
        wsUrl,
      });
    }
  );
}

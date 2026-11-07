import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifySession, revokeSession } from '../auth/better-auth';
import { extractSessionIdFromRequest } from '../auth/rbac';
import { GraywolfAppError } from '../errors/taxonomy';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/auth/session
  fastify.get('/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = extractSessionIdFromRequest(request);
    if (!sessionId && process.env.DEPLOYMENT_TOPOLOGY !== 'solo') {
      throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Session token is missing');
    }

    const session = await verifySession(sessionId);
    return reply.status(200).send({
      userId: session.userId,
      email: session.email,
      currentWorkspaceId: session.currentWorkspaceId,
      currentOrganizationId: session.currentOrganizationId,
      role: session.role,
    });
  });

  // POST /api/v1/auth/logout
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = extractSessionIdFromRequest(request);
    if (!sessionId) {
      throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Session token is missing');
    }

    const session = await verifySession(sessionId);
    await revokeSession(session.sessionId);

    reply.clearCookie('__session', { path: '/' });
    return reply.status(200).send({ success: true });
  });
}

import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import { createGlobalErrorHandler } from './errors/error-handler';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { workspaceRoutes, inviteRoutes } from './routes/workspaces';
import { projectRoutes } from './routes/projects';
import { taskRoutes } from './routes/tasks';
import { telemetryRoutes } from './routes/telemetry';
import { vcsWebhookRoutes } from './routes/webhooks-vcs';
import { chatRoutes } from './routes/chat';

export interface AppOptions extends FastifyServerOptions {
  disableRequestLogging?: boolean;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const { disableRequestLogging: _disableRequestLogging, ...fastifyOpts } = opts;
  void _disableRequestLogging;
  const fastify = Fastify({
    logger: fastifyOpts.logger ?? {
      level: process.env.LOG_LEVEL || 'info',
    },
    ...fastifyOpts,
  });

  // 1. Security & Core Plugins
  fastify.register(fastifyHelmet, {
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
  });

  fastify.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  fastify.register(fastifyCookie);

  fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 10 * 1024 * 1024, // 10MB payload ceiling
    },
  });

  // 2. Global Error Handler (ADR-042)
  fastify.setErrorHandler(createGlobalErrorHandler());

  // 3. Register Health Routes
  fastify.register(healthRoutes);

  // 4. Register Control Plane REST API (/api/v1)
  fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  fastify.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });
  fastify.register(inviteRoutes, { prefix: '/api/v1/invites' });
  fastify.register(projectRoutes, { prefix: '/api/v1/projects' });
  fastify.register(taskRoutes, { prefix: '/api/v1/tasks' });
  fastify.register(telemetryRoutes, { prefix: '/api/v1/telemetry' });
  fastify.register(vcsWebhookRoutes, { prefix: '/api/v1/webhooks/vcs' });
  fastify.register(chatRoutes, { prefix: '/api/v1/chat' });

  return fastify;
}

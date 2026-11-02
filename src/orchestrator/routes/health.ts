import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';

const HealthResponseSchema = Type.Object({
  ok: Type.Boolean({ description: 'Health status flag' }),
  timestamp: Type.String({ format: 'date-time', description: 'Current UTC timestamp' }),
});

export const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Root /health endpoint (used by Docker Compose healthcheck)
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        ok: true,
        timestamp: new Date().toISOString(),
      });
    }
  );

  // 2. Versioned /api/v1/healthz and /api/v1/health endpoints
  fastify.get(
    '/api/v1/healthz',
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        ok: true,
        timestamp: new Date().toISOString(),
      });
    }
  );

  fastify.get(
    '/api/v1/health',
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        ok: true,
        timestamp: new Date().toISOString(),
      });
    }
  );
};

import * as path from 'node:path';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type FastifyPluginAsync } from 'fastify';
import {
  exportDatasetJsonl,
  getDatasetStats,
  pruneExpiredTrajectoryMonths,
} from '../learning/dataset-manager';

/**
 * Dataset Statistics, OpenAI/ShareGPT Export & Retention Pruning REST Routes
 * (Phase 19, Task 19.2, ADR-064, ADR-079, FR-007).
 */

export interface DatasetRoutesOptions {
  outputBaseDir?: string;
}

export const DatasetExportQuerySchema = Type.Object({
  format: Type.Optional(
    Type.Union([Type.Literal('openai'), Type.Literal('sharegpt')])
  ),
  split: Type.Optional(
    Type.Union([
      Type.Literal('train'),
      Type.Literal('eval'),
      Type.Literal('all'),
    ])
  ),
  month: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
    })
  ),
});

export const DatasetPruneBodySchema = Type.Object({
  retentionMonths: Type.Integer({ minimum: 1, maximum: 120 }),
  referenceDate: Type.Optional(Type.String({ minLength: 4 })),
});

export const datasetRoutes: FastifyPluginAsync<DatasetRoutesOptions> = async (
  fastify,
  opts
) => {
  const baseDir =
    opts.outputBaseDir ?? path.join('.agents', 'dataset', 'trajectories');

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/dataset/stats',
    async (request, reply) => {
      const projectId = request.params.id;
      const stats = await getDatasetStats(projectId, baseDir);
      return reply.code(200).send(stats);
    }
  );

  fastify.get<{
    Params: { id: string };
    Querystring: Record<string, unknown>;
  }>('/api/v1/projects/:id/dataset/export', async (request, reply) => {
    const projectId = request.params.id;
    const query = request.query ?? {};

    if (!Value.Check(DatasetExportQuerySchema, query)) {
      return reply.code(400).send({
        code: 'ACI_VALIDATION_FAILED',
        message:
          'Invalid dataset export query parameters (expected format=openai|sharegpt, split=train|eval|all, month=YYYY-MM)',
      });
    }

    const result = await exportDatasetJsonl({
      projectId,
      format: query.format,
      split: query.split,
      month: query.month,
      outputBaseDir: baseDir,
    });

    return reply.code(200).send(result);
  });

  fastify.post<{
    Params: { id: string };
    Body: unknown;
  }>('/api/v1/projects/:id/dataset/prune', async (request, reply) => {
    const projectId = request.params.id;

    if (!Value.Check(DatasetPruneBodySchema, request.body)) {
      return reply.code(400).send({
        code: 'ACI_VALIDATION_FAILED',
        message:
          'Invalid dataset prune payload (expected integer retentionMonths >= 1)',
      });
    }

    const body = request.body;
    const referenceDate = body.referenceDate
      ? new Date(body.referenceDate)
      : new Date();

    if (Number.isNaN(referenceDate.getTime())) {
      return reply.code(400).send({
        code: 'ACI_VALIDATION_FAILED',
        message: 'Invalid referenceDate ISO string',
      });
    }

    const pruned = await pruneExpiredTrajectoryMonths(
      baseDir,
      body.retentionMonths,
      referenceDate
    );

    return reply.code(200).send({
      projectId,
      ...pruned,
    });
  });
};


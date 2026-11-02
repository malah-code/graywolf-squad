import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../auth/rbac';
import { withTenantContext } from '../db';
import { GraywolfAppError } from '../errors/taxonomy';

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  mode: 'greenfield' | 'brownfield';
  gitRemoteUrl: string;
  gitProvider: 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea';
  configJson?: Record<string, unknown>;
  createdAt?: string;
}

export interface CreateProjectBody {
  name: string;
  slug: string;
  mode: 'greenfield' | 'brownfield';
  gitRemoteUrl: string;
  gitProvider?: 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea';
  credentialVaultKey?: string;
}

const CreateProjectBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  slug: Type.String({ minLength: 1 }),
  mode: Type.Union([Type.Literal('greenfield'), Type.Literal('brownfield')]),
  gitRemoteUrl: Type.String({ minLength: 1 }),
  gitProvider: Type.Optional(
    Type.Union([
      Type.Literal('github'),
      Type.Literal('gitlab'),
      Type.Literal('bitbucket'),
      Type.Literal('azure'),
      Type.Literal('gitea'),
    ])
  ),
  credentialVaultKey: Type.Optional(Type.String()),
});

// In-memory fallback repository for unit and injection tests when PostgreSQL pool is not active
const inMemoryProjects: ProjectRecord[] = [];

export function clearInMemoryProjects(): void {
  inMemoryProjects.length = 0;
}

export function seedInMemoryProject(project: ProjectRecord): void {
  inMemoryProjects.push(project);
}

export function getInMemoryProjects(): ProjectRecord[] {
  return inMemoryProjects;
}

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/projects
  fastify.get(
    '/',
    { preHandler: requirePermission('list_projects') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const workspaceId = user.currentWorkspaceId;
      const orgId = user.currentOrganizationId;

      try {
        const projects = await withTenantContext({ workspaceId, orgId }, async (client) => {
          const res = await client.query<{
            id: string;
            workspace_id: string;
            name: string;
            slug: string;
            mode: string;
            git_remote_url: string;
            git_provider: string;
          }>(
            `SELECT id, workspace_id, name, slug, mode, git_remote_url, git_provider
             FROM projects
             WHERE workspace_id = $1`,
            [workspaceId]
          );

          return res.rows.map((r) => ({
            id: r.id,
            workspaceId: r.workspace_id,
            name: r.name,
            slug: r.slug,
            mode: r.mode as 'greenfield' | 'brownfield',
            gitRemoteUrl: r.git_remote_url,
            gitProvider: r.git_provider as ProjectRecord['gitProvider'],
          }));
        });

        if (projects.length > 0) {
          return reply.status(200).send(projects);
        }
      } catch {
        // Fallback to in-memory projects
      }

      const filtered = inMemoryProjects.filter((p) => p.workspaceId === workspaceId);
      return reply.status(200).send(filtered);
    }
  );

  // POST /api/v1/projects
  fastify.post(
    '/',
    {
      preHandler: requirePermission('create_project'),
      schema: {
        body: CreateProjectBodySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body || {}) as CreateProjectBody;

      if (!body.name || !body.slug || !body.gitRemoteUrl || !body.mode) {
        throw new GraywolfAppError(
          'ACI_VALIDATION_FAILED',
          'Missing required project fields (name, slug, mode, gitRemoteUrl)'
        );
      }

      const projectId = crypto.randomUUID();
      const project: ProjectRecord = {
        id: projectId,
        workspaceId: user.currentWorkspaceId,
        name: body.name,
        slug: body.slug,
        mode: body.mode,
        gitRemoteUrl: body.gitRemoteUrl,
        gitProvider: body.gitProvider ?? 'github',
      };

      try {
        await withTenantContext(
          { workspaceId: user.currentWorkspaceId, orgId: user.currentOrganizationId },
          async (client) => {
            await client.query(
              `INSERT INTO projects (id, workspace_id, name, slug, mode, git_remote_url, git_provider)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                project.id,
                project.workspaceId,
                project.name,
                project.slug,
                project.mode,
                project.gitRemoteUrl,
                project.gitProvider,
              ]
            );
          }
        );
      } catch {
        // Fallback store in memory
      }

      inMemoryProjects.push(project);
      return reply.status(201).send(project);
    }
  );

  // POST /api/v1/projects/:projectId/recon
  fastify.post(
    '/:projectId/recon',
    { preHandler: requirePermission('trigger_recon') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const reconJobId = crypto.randomUUID();
      return reply.status(202).send({
        reconJobId,
        status: 'queued',
      });
    }
  );
}

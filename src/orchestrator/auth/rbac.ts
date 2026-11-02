import path from 'node:path';
import { newEnforcer, Enforcer } from 'casbin';
import { FastifyRequest, FastifyReply } from 'fastify';
import pino from 'pino';
import { GraywolfAppError } from '../errors/taxonomy';
import { WorkspaceRole, verifySession, SessionData } from './better-auth';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionData;
    tenantContext?: { workspaceId: string; orgId: string };
  }
}

const logger = pino({ name: 'auth:rbac' });

export function extractSessionIdFromRequest(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)__session=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  if (typeof request.headers['x-session-id'] === 'string') {
    return request.headers['x-session-id'];
  }

  const auth = request.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  return undefined;
}

export const RBAC_ACTIONS = [
  // viewer
  'list_workspaces',
  'list_projects',
  'list_tasks',
  'ws_ticket_read',

  // developer
  'create_task',
  'dispatch_task',
  'answer_clarification',
  'reorder_backlog',
  'chat_turn',
  'change_access_mode_pill',

  // lead_dev
  'create_project',
  'trigger_recon',
  'modify_blast_radius',
  'approve_review_gate',
  'create_invite',
  'promote_addon',

  // owner
  'manage_keys',
  'manage_budgets',
  'manage_team_roles',
] as const;

export type RbacAction = (typeof RBAC_ACTIONS)[number];

let globalEnforcer: Enforcer | null = null;

export async function getRbacEnforcer(
  modelPath?: string,
  policyPath?: string
): Promise<Enforcer> {
  if (globalEnforcer && !modelPath && !policyPath) {
    return globalEnforcer;
  }

  const defaultModelPath =
    modelPath ?? path.resolve(process.cwd(), 'config/rbac/model.conf');
  const defaultPolicyPath =
    policyPath ?? path.resolve(process.cwd(), 'config/rbac/policy.csv');

  try {
    const enforcer = await newEnforcer(defaultModelPath, defaultPolicyPath);
    if (!modelPath && !policyPath) {
      globalEnforcer = enforcer;
    }
    return enforcer;
  } catch (err) {
    logger.error({ err, defaultModelPath, defaultPolicyPath }, 'Failed to initialize Casbin enforcer');
    throw err;
  }
}

export function resetRbacEnforcer(): void {
  globalEnforcer = null;
}

export interface EnforceOptions {
  isCockpitTool?: boolean;
}

/**
 * Checks if a given role is permitted to perform the specified action.
 */
export async function checkPermission(
  role: WorkspaceRole,
  action: RbacAction,
  enforcerInstance?: Enforcer
): Promise<boolean> {
  const enforcer = enforcerInstance ?? (await getRbacEnforcer());
  return enforcer.enforce(role, action);
}

/**
 * Enforces permissions for a role against an action, throwing exact ADR-042 taxonomy codes on denial:
 * - RBAC_COCKPIT_TOOL_FORBIDDEN (403) for model tool-call denials
 * - RBAC_MERGE_NOT_AUTHORIZED (403) for review gate approvals
 * - RBAC_KEY_MANAGEMENT_DENIED (403) for API keys / budgets
 * - RBAC_INSUFFICIENT_ROLE (403) for general endpoint permission denials
 */
export async function enforcePermission(
  role: WorkspaceRole,
  action: RbacAction,
  options?: EnforceOptions,
  enforcerInstance?: Enforcer
): Promise<void> {
  const allowed = await checkPermission(role, action, enforcerInstance);
  if (allowed) {
    return;
  }

  if (options?.isCockpitTool) {
    throw new GraywolfAppError(
      'RBAC_COCKPIT_TOOL_FORBIDDEN',
      `Cockpit tool execution denied: role '${role}' is not authorized to execute '${action}'`
    );
  }

  if (action === 'approve_review_gate') {
    throw new GraywolfAppError(
      'RBAC_MERGE_NOT_AUTHORIZED',
      `Merge approval denied: role '${role}' is not authorized to approve review gates. Requires lead_dev or owner.`
    );
  }

  if (action === 'manage_keys' || action === 'manage_budgets') {
    throw new GraywolfAppError(
      'RBAC_KEY_MANAGEMENT_DENIED',
      `Key and budget management denied: role '${role}' is not authorized. Requires owner.`
    );
  }

  throw new GraywolfAppError(
    'RBAC_INSUFFICIENT_ROLE',
    `Access denied: role '${role}' lacks permission for '${action}'`
  );
}

/**
 * Fastify preHandler authorization hook that extracts the user's session,
 * verifies active credentials, injects context, and enforces Casbin RBAC.
 */
export function requirePermission(
  action: RbacAction,
  options?: EnforceOptions
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function rbacPreHandler(
    request: FastifyRequest,
    _reply: FastifyReply
  ): Promise<void> {
    // 1. Extract session token from cookie, header, or Bearer auth
    const sessionId = extractSessionIdFromRequest(request);

    // 2. Verify stateful session
    const session = await verifySession(sessionId);
    request.user = session;
    request.tenantContext = {
      workspaceId: session.currentWorkspaceId,
      orgId: session.currentOrganizationId,
    };

    // 3. Enforce Casbin RBAC for user role
    await enforcePermission(session.role, action, options);
  };
}

import { withTenantContext } from '../db';
import { GraywolfAppError } from '../errors/taxonomy';

/**
 * External Identity Binding & Human Intent Parser (Task 15.2c, ADR-080, PRD §17, FR-006).
 *
 * Verifies `(workspace_id, provider, external_provider_user_id)` in `workspace_member_identities`
 * before allowing any external Discord/Slack/MSTeams user to trigger a control-plane intent.
 * If unlinked, throws `GraywolfAppError('ADDON_UNLINKED_EXTERNAL_USER')` (HTTP 403).
 */

export type CockpitPlatform = 'discord' | 'slack' | 'msteams' | 'custom';

export type HumanCockpitIntent = 'approve' | 'reject' | 'escalate' | 'unknown';

const TASK_ID_REGEX = /\b(TASK-[0-9A-Z-]+)\b/i;

/**
 * Deterministically parses `intentText` into `{ taskId, intent }`.
 */
export function parseHumanIntentText(
  intentText: string,
  fallbackTaskId = 'TASK-UNKNOWN'
): {
  taskId: string;
  intent: HumanCockpitIntent;
} {
  const trimmed = intentText.trim();
  const taskMatch = TASK_ID_REGEX.exec(trimmed);
  const taskId = taskMatch ? taskMatch[1].toUpperCase() : fallbackTaskId;

  if (/^(?:\/)?approve\b|\blgtm\b|\bship\s+it\b/i.test(trimmed)) {
    return { taskId, intent: 'approve' };
  }
  if (/^(?:\/)?reject\b|\bdiscard\b|\bdeny\b/i.test(trimmed)) {
    return { taskId, intent: 'reject' };
  }
  if (/^(?:\/)?escalate\b|\bblock\b/i.test(trimmed)) {
    return { taskId, intent: 'escalate' };
  }

  return { taskId, intent: 'unknown' };
}

/**
 * Looks up `(workspace_id, provider, external_provider_user_id)` in PostgreSQL `workspace_member_identities`
 * (or via `lookupOverride`). Throws `ADDON_UNLINKED_EXTERNAL_USER` (HTTP 403) if no verified binding exists.
 */
export async function resolveAndVerifyExternalIdentity(input: {
  workspaceId: string;
  platform: CockpitPlatform;
  actorExternalId: string;
  lookupOverride?: (q: {
    workspaceId: string;
    platform: string;
    actorExternalId: string;
  }) => Promise<string | null>;
}): Promise<{ actorUserId: string }> {
  const actorExternalId = input.actorExternalId.trim();
  if (!actorExternalId) {
    throw new GraywolfAppError(
      'ADDON_UNLINKED_EXTERNAL_USER',
      'Missing actorExternalId in external cockpit intent',
      {
        workspaceId: input.workspaceId,
        platform: input.platform,
      }
    );
  }

  let resolvedUserId: string | null = null;

  if (input.lookupOverride) {
    resolvedUserId = await input.lookupOverride({
      workspaceId: input.workspaceId,
      platform: input.platform,
      actorExternalId,
    });
  } else {
    try {
      resolvedUserId = await withTenantContext(
        { workspaceId: input.workspaceId },
        async (client) => {
          const res = await client.query<{ user_id: string }>(
            `SELECT user_id
               FROM workspace_member_identities
              WHERE workspace_id = $1
                AND provider = $2
                AND external_provider_user_id = $3
              LIMIT 1`,
            [input.workspaceId, input.platform, actorExternalId]
          );
          return res.rows[0]?.user_id ?? null;
        }
      );
    } catch {
      resolvedUserId = null;
    }
  }

  if (!resolvedUserId) {
    throw new GraywolfAppError(
      'ADDON_UNLINKED_EXTERNAL_USER',
      `External user '${actorExternalId}' on platform '${input.platform}' is not linked to a workspace member`,
      {
        workspaceId: input.workspaceId,
        platform: input.platform,
        actorExternalId,
      }
    );
  }

  return { actorUserId: resolvedUserId };
}

/**
 * Full helper combining external identity verification and human intent parsing for `receiveHumanIntent`.
 */
export async function executeVerifiedHumanIntent(input: {
  workspaceId: string;
  platform: CockpitPlatform;
  externalMessageId: string;
  intentText: string;
  actorExternalId: string;
  fallbackTaskId?: string;
  lookupOverride?: (q: {
    workspaceId: string;
    platform: string;
    actorExternalId: string;
  }) => Promise<string | null>;
}): Promise<{
  taskId: string;
  intent: HumanCockpitIntent;
  actorUserId: string;
}> {
  const { actorUserId } = await resolveAndVerifyExternalIdentity({
    workspaceId: input.workspaceId,
    platform: input.platform,
    actorExternalId: input.actorExternalId,
    lookupOverride: input.lookupOverride,
  });

  const parsed = parseHumanIntentText(input.intentText, input.fallbackTaskId);
  return {
    taskId: parsed.taskId,
    intent: parsed.intent,
    actorUserId,
  };
}


import { TaskStatus } from '../schemas/task';

/**
 * Bidirectional External PM Sync Service (Task 11.4b, PRD §10.1, FR-004, SC-004).
 *
 * Implements bidirectional state sync between Graywolf Squad and external
 * PM issue trackers (GitHub Issues, GitLab Issues, Jira, Linear).
 *
 * Authority Rules:
 *  1. Graywolf owns execution lifecycle state (TaskStatus) — external status overrides are rejected.
 *  2. External PM tools own taxonomy (labels) and ownership (assignees).
 */

export type ExternalPmProvider = 'github' | 'gitlab' | 'jira' | 'linear';

export interface ExternalIssueState {
  externalId: string;
  provider: ExternalPmProvider;
  statusLabel: string;
  labels: string[];
  assignees: string[];
}

export interface ReconcileStateOptions {
  taskId: string;
  graywolfStatus: TaskStatus;
  externalIssue: ExternalIssueState;
  incomingExternalUpdate?: {
    attemptedStatusOverride?: string;
    labels?: string[];
    assignees?: string[];
  };
}

export interface ReconciledPmState {
  authoritativeGraywolfStatus: TaskStatus;
  syncedExternalStatusLabel: string;
  authoritativeLabels: string[];
  authoritativeAssignees: string[];
  externalOverrideIgnored: boolean;
}

export function mapGraywolfStatusToExternalLabel(
  provider: ExternalPmProvider,
  status: TaskStatus
): string {
  switch (status) {
    case 'BACKLOG':
      return 'Backlog';
    case 'QUEUED':
      return provider === 'jira' ? 'To Do' : 'Ready';
    case 'IN_PROGRESS':
      return 'In Progress';
    case 'INTERNAL_REVIEW':
      return 'Under Review';
    case 'GUARD_VERIFYING':
      return 'QA Verifying';
    case 'HUMAN_REVIEW_GATE':
      return 'Awaiting Approval';
    case 'QA_FIXING':
      return 'QA Rework';
    case 'AWAITING_CLARIFICATION':
      return 'Awaiting Clarification';
    case 'ESCALATED':
      return 'Escalated';
    case 'UPDATED':
      return 'Updated';
    case 'MERGED':
      return provider === 'jira' || provider === 'linear' ? 'Done' : 'Closed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'BLOCKED':
    case 'REJECTED':
    case 'VERIFICATION_FAILED':
    case 'INTERNAL_REVIEW_FAILED':
      return 'Blocked';
    default:
      return status;
  }
}

export class PmSyncService {
  public reconcileState(options: ReconcileStateOptions): ReconciledPmState {
    const { graywolfStatus, externalIssue, incomingExternalUpdate } = options;

    // 1. Graywolf owns execution lifecycle state (TaskStatus). External status overrides are rejected.
    const externalOverrideIgnored =
      Boolean(incomingExternalUpdate?.attemptedStatusOverride) &&
      incomingExternalUpdate?.attemptedStatusOverride !== externalIssue.statusLabel;

    const authoritativeGraywolfStatus: TaskStatus = graywolfStatus;
    const syncedExternalStatusLabel = mapGraywolfStatusToExternalLabel(
      externalIssue.provider,
      authoritativeGraywolfStatus
    );

    // 2. External PM tools own labels and assignees.
    const authoritativeLabels =
      incomingExternalUpdate?.labels !== undefined
        ? [...incomingExternalUpdate.labels]
        : [...externalIssue.labels];

    const authoritativeAssignees =
      incomingExternalUpdate?.assignees !== undefined
        ? [...incomingExternalUpdate.assignees]
        : [...externalIssue.assignees];

    return {
      authoritativeGraywolfStatus,
      syncedExternalStatusLabel,
      authoritativeLabels,
      authoritativeAssignees,
      externalOverrideIgnored,
    };
  }
}

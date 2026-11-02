import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * Container Terminal-State Protocol Contract (Task 14.3b, ADR-059, PRD §9.9, FR-005).
 *
 * Validates that `<worktree>/.agent_status.json` exists and conforms to the TypeBox contract
 * whenever a container exits with `rc=0`. If missing or schema-invalid, issues up to 2 synthetic
 * re-entry nudges before marking `protocol_violation`, incrementing the Two-Strike counter,
 * and escalating to human review.
 */

export const AgentTerminalStatusSchema = Type.Object({
  status: Type.Union([
    Type.Literal('patch_ready'),
    Type.Literal('blocked'),
    Type.Literal('needs_clarification'),
  ]),
  summary: Type.String({ minLength: 1 }),
  artifacts: Type.Array(Type.String()),
  exit_reason: Type.String({ minLength: 1 }),
});

export type AgentTerminalStatus = Static<typeof AgentTerminalStatusSchema>;

export interface StatusProtocolOutcome {
  taskId: string;
  valid: boolean;
  protocolStatus:
    | 'patch_ready'
    | 'blocked'
    | 'needs_clarification'
    | 'nudge_retry'
    | 'protocol_violation'
    | 'non_zero_exit';
  statusPayload: AgentTerminalStatus | null;
  nudgeRequired: boolean;
  nudgeCount: number;
  nudgeMessage: string | null;
  strikeIncrement: 0 | 1;
  escalated: boolean;
}

/**
 * Verifies the `.agent_status.json` terminal-state protocol when a container exits.
 */
export async function verifyTerminalStatusProtocol(input: {
  taskId: string;
  worktreeDir: string;
  exitCode: number;
  previousNudges: number;
}): Promise<StatusProtocolOutcome> {
  if (input.exitCode !== 0) {
    return {
      taskId: input.taskId,
      valid: false,
      protocolStatus: 'non_zero_exit',
      statusPayload: null,
      nudgeRequired: false,
      nudgeCount: input.previousNudges,
      nudgeMessage: null,
      strikeIncrement: 0,
      escalated: false,
    };
  }

  const statusFilePath = path.join(input.worktreeDir, '.agent_status.json');
  let parsedPayload: unknown = null;
  let failureDetail = '';

  try {
    const raw = await fs.readFile(statusFilePath, 'utf8');
    parsedPayload = JSON.parse(raw);
  } catch (err: unknown) {
    failureDetail =
      err instanceof Error ? err.message : 'Missing or unreadable .agent_status.json';
  }

  if (parsedPayload !== null && Value.Check(AgentTerminalStatusSchema, parsedPayload)) {
    return {
      taskId: input.taskId,
      valid: true,
      protocolStatus: parsedPayload.status,
      statusPayload: parsedPayload,
      nudgeRequired: false,
      nudgeCount: input.previousNudges,
      nudgeMessage: null,
      strikeIncrement: 0,
      escalated: false,
    };
  }

  if (!failureDetail) {
    const errors = [...Value.Errors(AgentTerminalStatusSchema, parsedPayload)];
    failureDetail = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
  }

  // Missing or invalid status file on rc=0 exit: allow up to 2 synthetic re-entry nudges
  if (input.previousNudges < 2) {
    const nextNudge = input.previousNudges + 1;
    return {
      taskId: input.taskId,
      valid: false,
      protocolStatus: 'nudge_retry',
      statusPayload: null,
      nudgeRequired: true,
      nudgeCount: nextNudge,
      nudgeMessage: `Protocol Violation (Nudge ${nextNudge}/2): Container exited rc=0 without a valid .agent_status.json (${failureDetail}). Write a valid .agent_status.json with status ("patch_ready" | "blocked" | "needs_clarification"), summary, artifacts, and exit_reason before exiting.`,
      strikeIncrement: 0,
      escalated: false,
    };
  }

  // After 2 failed nudges -> protocol_violation, Two-Strike increment, escalate to human
  return {
    taskId: input.taskId,
    valid: false,
    protocolStatus: 'protocol_violation',
    statusPayload: null,
    nudgeRequired: false,
    nudgeCount: input.previousNudges,
    nudgeMessage: `Terminal protocol violation after ${input.previousNudges} failed nudges (${failureDetail}). Escalating to human review.`,
    strikeIncrement: 1,
    escalated: true,
  };
}


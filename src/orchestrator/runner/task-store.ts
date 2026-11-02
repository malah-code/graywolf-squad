import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { withTenantContext } from '../db';
import { GraywolfAppError } from '../errors/taxonomy';

export type TaskArtifactFileName =
  | 'brief.md'
  | 'plan.md'
  | 'changes.patch'
  | 'result.json'
  | 'verification.md'
  | 'review-signoff.md'
  | 'escalation-request.md'
  | 'escalation-memo.md'
  | 'clarification-request.md';

export const ARTIFACT_TYPE_MAP: Record<TaskArtifactFileName, string> = {
  'brief.md': 'brief',
  'plan.md': 'plan',
  'changes.patch': 'patch',
  'result.json': 'result',
  'verification.md': 'verification',
  'review-signoff.md': 'review-signoff',
  'escalation-request.md': 'escalation-request',
  'escalation-memo.md': 'escalation-memo',
  'clarification-request.md': 'clarification-request',
};

export const TASK_SUBDIRECTORIES = ['e2e-cache', 'review'] as const;

export interface TaskStoreOptions {
  baseDir?: string; // defaults to path.resolve(process.cwd(), '.agents/tasks')
  workspaceId?: string;
  orgId?: string;
  syncToDb?: boolean;
}

export interface TaskArtifactItem {
  fileName: string;
  filePath: string;
  contentHash: string;
  artifactType: string;
}

export function computeSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function getTaskDirectory(taskId: string, baseDir?: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId) || taskId === '.' || taskId === '..') {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Invalid taskId for filesystem path: "${taskId}"`,
      { taskId }
    );
  }
  const root = baseDir ? path.resolve(baseDir) : path.resolve(process.cwd(), '.agents/tasks');
  const resolved = path.resolve(root, taskId);
  if (!resolved.startsWith(root + path.sep)) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Task directory path traversal blocked for taskId: "${taskId}"`,
      { taskId }
    );
  }
  return resolved;
}

/**
 * Initializes .agents/tasks/<TASK_ID>/ and its subdirectories (e2e-cache/, review/).
 */
export async function initTaskDirectory(
  taskId: string,
  options?: TaskStoreOptions
): Promise<string> {
  const taskDir = getTaskDirectory(taskId, options?.baseDir);
  await fs.mkdir(taskDir, { recursive: true });

  for (const sub of TASK_SUBDIRECTORIES) {
    await fs.mkdir(path.join(taskDir, sub), { recursive: true });
  }

  return taskDir;
}

/**
 * Writes a task artifact to disk, calculates its SHA-256 hash,
 * and optionally syncs metadata to the task_artifacts table inside withTenantContext.
 */
export async function writeTaskArtifact(
  taskId: string,
  fileName: TaskArtifactFileName,
  content: string,
  options?: TaskStoreOptions & { authoredBy?: string }
): Promise<{ filePath: string; contentHash: string }> {
  const taskDir = await initTaskDirectory(taskId, options);
  const filePath = path.join(taskDir, fileName);
  const contentHash = computeSha256(content);

  await fs.writeFile(filePath, content, 'utf8');

  if (options?.syncToDb && options.workspaceId) {
    const artifactType = ARTIFACT_TYPE_MAP[fileName] ?? 'unknown';
    const authoredBy = options.authoredBy ?? null;
    const relPath = path.relative(process.cwd(), filePath);

    await withTenantContext(
      { workspaceId: options.workspaceId, orgId: options.orgId },
      async (client) => {
        const updateResult = await client.query(
          `UPDATE task_artifacts
           SET content_hash = $1, authored_by = COALESCE($2, authored_by), created_at = NOW()
           WHERE task_id = $3 AND file_path = $4`,
          [contentHash, authoredBy, taskId, relPath]
        );

        if ((updateResult.rowCount ?? 0) === 0) {
          await client.query(
            `INSERT INTO task_artifacts (task_id, workspace_id, artifact_type, authored_by, file_path, content_hash)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [taskId, options.workspaceId, artifactType, authoredBy, relPath, contentHash]
          );
        }
      }
    );
  }

  return { filePath, contentHash };
}

/**
 * Reads a task artifact from disk and computes its SHA-256 contentHash.
 */
export async function readTaskArtifact(
  taskId: string,
  fileName: TaskArtifactFileName,
  options?: TaskStoreOptions
): Promise<{ content: string; contentHash: string }> {
  const taskDir = getTaskDirectory(taskId, options?.baseDir);
  const filePath = path.join(taskDir, fileName);
  const content = await fs.readFile(filePath, 'utf8');
  const contentHash = computeSha256(content);
  return { content, contentHash };
}

/**
 * Lists all known task artifacts present in the task directory.
 */
export async function listTaskArtifacts(
  taskId: string,
  options?: TaskStoreOptions
): Promise<TaskArtifactItem[]> {
  const taskDir = getTaskDirectory(taskId, options?.baseDir);
  const results: TaskArtifactItem[] = [];

  try {
    const entries = await fs.readdir(taskDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const fileName = entry.name as TaskArtifactFileName;
        const filePath = path.join(taskDir, fileName);
        const content = await fs.readFile(filePath, 'utf8');
        const contentHash = computeSha256(content);
        const artifactType = ARTIFACT_TYPE_MAP[fileName] || 'other';
        results.push({
          fileName,
          filePath,
          contentHash,
          artifactType,
        });
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  return results;
}

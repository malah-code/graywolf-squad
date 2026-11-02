import picomatch from 'picomatch';
import { TaskStatus } from '../schemas/task';
import { GraywolfAppError } from '../errors/taxonomy';

export interface DagTaskNode {
  id: string;
  status: TaskStatus;
  blockedBy: string[];
  writableScope: string[];
  targetFiles?: string[];
  explicitDbTier?: 'tier-0-mock' | 'tier-1-shared-db' | 'tier-2-isolated-db';
  plannerDeclaredDbTier?: 'tier-0-mock' | 'tier-1-shared-db' | 'tier-2-isolated-db';
  requiresBrowserE2E?: boolean;
}

export interface ScopeOverlapResult {
  overlaps: boolean;
  overlappingTaskIds: string[];
  reasons: string[];
}

export interface TaskReadyOptions {
  allowBranchStacking?: boolean;
}

const PACKAGE_MANIFEST_PATTERNS = [
  '**/package.json',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/Cargo.toml',
  '**/Cargo.lock',
  '**/go.mod',
  '**/go.sum',
  '**/requirements.txt',
  '**/poetry.lock',
  '**/Gemfile',
  '**/pom.xml',
  '**/build.gradle',
];

const isPackageManifestMatch = picomatch(PACKAGE_MANIFEST_PATTERNS);

function getNodeFromMap(
  allTasksMap: ReadonlyMap<string, DagTaskNode> | Record<string, DagTaskNode>,
  id: string
): DagTaskNode | undefined {
  if (allTasksMap instanceof Map) {
    return allTasksMap.get(id);
  }
  return (allTasksMap as Record<string, DagTaskNode>)[id];
}

/**
 * Detects whether there is any dependency cycle in the given task list.
 * Returns the cycle path as an array of task IDs (e.g. ['A', 'B', 'A']) or null if acyclic.
 */
export function detectDependencyCycle(tasks: DagTaskNode[]): string[] | null {
  const taskMap = new Map<string, DagTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  // 0 = unvisited, 1 = visiting (in current DFS stack), 2 = visited
  const state = new Map<string, number>();
  const parent = new Map<string, string>();

  for (const t of tasks) {
    state.set(t.id, 0);
  }

  for (const t of tasks) {
    if (state.get(t.id) === 0) {
      const cycle = dfs(t.id);
      if (cycle) return cycle;
    }
  }

  return null;

  function dfs(currentId: string): string[] | null {
    state.set(currentId, 1);
    const node = taskMap.get(currentId);

    if (node) {
      for (const blockerId of node.blockedBy) {
        // Self-cycle
        if (blockerId === currentId) {
          return [currentId, currentId];
        }

        // Only traverse if the blocker task exists in the task map
        if (!taskMap.has(blockerId)) {
          continue;
        }

        const blockerState = state.get(blockerId) ?? 0;
        if (blockerState === 1) {
          // Cycle found, reconstruct cycle path
          const path: string[] = [blockerId, currentId];
          let curr = currentId;
          while (parent.has(curr) && parent.get(curr) !== blockerId) {
            curr = parent.get(curr)!;
            path.push(curr);
          }
          path.push(blockerId);
          path.reverse();
          return path;
        }

        if (blockerState === 0) {
          parent.set(blockerId, currentId);
          const res = dfs(blockerId);
          if (res) return res;
        }
      }
    }

    state.set(currentId, 2);
    return null;
  }
}

/**
 * Asserts that the task set contains no dependency cycles.
 * Throws TASK_INVALID_STATE_TRANSITION (409) if a cycle is detected.
 */
export function assertNoDependencyCycle(tasks: DagTaskNode[]): void {
  const cycle = detectDependencyCycle(tasks);
  if (cycle) {
    throw new GraywolfAppError(
      'TASK_INVALID_STATE_TRANSITION',
      `Circular dependency detected in task DAG: ${cycle.join(' -> ')}`,
      { cycle }
    );
  }
}

/**
 * Topologically sorts tasks such that dependencies (blockers) appear before dependents.
 */
export function topologicalSortTasks(tasks: DagTaskNode[]): DagTaskNode[] {
  assertNoDependencyCycle(tasks);

  const taskMap = new Map<string, DagTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const visited = new Set<string>();
  const result: DagTaskNode[] = [];

  function visit(taskId: string) {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const node = taskMap.get(taskId);
    if (node) {
      for (const blockerId of node.blockedBy) {
        if (taskMap.has(blockerId)) {
          visit(blockerId);
        }
      }
      result.push(node);
    }
  }

  for (const t of tasks) {
    visit(t.id);
  }

  return result;
}

/**
 * Evaluates whether all blocking dependencies for a task are satisfied.
 */
export function isTaskReady(
  task: DagTaskNode,
  allTasksMap: ReadonlyMap<string, DagTaskNode> | Record<string, DagTaskNode>,
  options?: TaskReadyOptions
): boolean {
  if (!task.blockedBy || task.blockedBy.length === 0) {
    return true;
  }

  const branchStackingStates: TaskStatus[] = [
    'INTERNAL_REVIEW',
    'GUARD_VERIFYING',
    'HUMAN_REVIEW_GATE',
    'MERGED',
  ];

  for (const blockerId of task.blockedBy) {
    const blocker = getNodeFromMap(allTasksMap, blockerId);
    if (!blocker) {
      return false; // Blocker not found / unresolved
    }

    if (options?.allowBranchStacking) {
      if (!branchStackingStates.includes(blocker.status)) {
        return false;
      }
    } else {
      if (blocker.status !== 'MERGED') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Asserts that a task is ready for dispatch, throwing TASK_BLOCKED_BY_DEPENDENCIES (409) if not.
 */
export function assertTaskReadyForDispatch(
  task: DagTaskNode,
  allTasksMap: ReadonlyMap<string, DagTaskNode> | Record<string, DagTaskNode>,
  options?: TaskReadyOptions
): void {
  const unresolved: string[] = [];

  for (const blockerId of task.blockedBy) {
    const blocker = getNodeFromMap(allTasksMap, blockerId);
    if (!blocker) {
      unresolved.push(`${blockerId} (missing)`);
      continue;
    }

    if (options?.allowBranchStacking) {
      const allowed: TaskStatus[] = [
        'INTERNAL_REVIEW',
        'GUARD_VERIFYING',
        'HUMAN_REVIEW_GATE',
        'MERGED',
      ];
      if (!allowed.includes(blocker.status)) {
        unresolved.push(`${blockerId} (${blocker.status})`);
      }
    } else {
      if (blocker.status !== 'MERGED') {
        unresolved.push(`${blockerId} (${blocker.status})`);
      }
    }
  }

  if (unresolved.length > 0) {
    throw new GraywolfAppError(
      'TASK_BLOCKED_BY_DEPENDENCIES',
      `Cannot dispatch task '${task.id}': blocked by unresolved dependencies: ${unresolved.join(', ')}`,
      { taskId: task.id, unresolvedBlockers: unresolved }
    );
  }
}

function hasManifestConflict(patterns: string[]): boolean {
  return patterns.some((p) => isPackageManifestMatch(p));
}

function normalizeScopePath(scope: string): string {
  return scope
    .replace(/^\.\//, '')
    .replace(/\/\*\*\/.*$/, '')
    .replace(/\/\*.*$/, '')
    .replace(/\/\*\*$/, '')
    .replace(/\/\*$/, '');
}

/**
 * Checks for Pre-Dispatch Scope Overlap (ADR-031) between candidate task and active tasks.
 */
export function hasWritableScopeOverlap(
  candidateTask: DagTaskNode,
  activeTasks: DagTaskNode[]
): ScopeOverlapResult {
  const overlappingTaskIds: string[] = [];
  const reasons: string[] = [];

  const candidateAllPatterns = [
    ...candidateTask.writableScope,
    ...(candidateTask.targetFiles ?? []),
  ];

  const candidateHasManifest = hasManifestConflict(candidateAllPatterns);

  for (const active of activeTasks) {
    if (active.id === candidateTask.id) continue;

    const activeAllPatterns = [
      ...active.writableScope,
      ...(active.targetFiles ?? []),
    ];

    // Check Rule 1: Shared Package Manifest Conflict
    if (candidateHasManifest && hasManifestConflict(activeAllPatterns)) {
      overlappingTaskIds.push(active.id);
      reasons.push(
        `Shared package manifest conflict between task '${candidateTask.id}' and active task '${active.id}'`
      );
      continue;
    }

    // Check Rule 2: Path prefix and glob pattern intersection
    let hasOverlap = false;

    // Check globs using picomatch
    for (const cPattern of candidateAllPatterns) {
      const isMatch = picomatch(cPattern);
      for (const aPattern of activeAllPatterns) {
        if (isMatch(aPattern) || picomatch(aPattern)(cPattern)) {
          overlappingTaskIds.push(active.id);
          reasons.push(
            `Scope pattern match between '${cPattern}' and '${aPattern}' (task '${active.id}')`
          );
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) break;
    }

    if (hasOverlap) continue;

    // Check directory prefix containment
    for (const cScope of candidateTask.writableScope) {
      const normC = normalizeScopePath(cScope);
      for (const aScope of active.writableScope) {
        const normA = normalizeScopePath(aScope);
        if (normC === normA || normC.startsWith(`${normA}/`) || normA.startsWith(`${normC}/`)) {
          overlappingTaskIds.push(active.id);
          reasons.push(
            `Writable scope directory intersection between '${cScope}' and '${aScope}' (task '${active.id}')`
          );
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) break;
    }
  }

  return {
    overlaps: overlappingTaskIds.length > 0,
    overlappingTaskIds,
    reasons,
  };
}

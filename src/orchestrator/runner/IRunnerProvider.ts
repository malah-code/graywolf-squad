/**
 * IRunnerProvider interface.
 * Based on ADR-040: Agnostic Runner API
 * Decouples the Orchestrator from the specific backend (Docker, K8s, modal).
 */
export interface TaskSandboxOptions {
  taskId: string;
  image: string;
  bindMounts?: { source: string; target: string; readonly?: boolean }[];
  env?: Record<string, string>;
  networkMode?: string;
  command?: string[];
  projectId?: string;
  worktreePath?: string;
  parentGitDir?: string;
  pkgCacheDir?: string;
  relayDir?: string;
  memoryBytes?: number;
}

export interface IRunnerProvider {
  /**
   * Provisions and starts a sandboxed container for a specific task.
   */
  startSandbox(options: TaskSandboxOptions): Promise<{ containerId: string }>;

  /**
   * Tears down a specific sandbox (kills process group and removes container).
   */
  teardownSandbox(taskId: string): Promise<void>;

  /**
   * Wait for a container to exit and return its exit code.
   */
  waitForExit(taskId: string): Promise<number>;
}

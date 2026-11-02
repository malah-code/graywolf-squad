import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';
import matter from 'gray-matter';
import { computeSha256 } from './task-store';

export interface TaskBriefFrontmatter {
  writableScope?: string[] | string;
  blockedBy?: string[] | string;
  targetFiles?: string[] | string;
  [key: string]: unknown;
}

export interface TaskInjectEvent {
  type: 'task.inject';
  taskId: string;
  contentHash: string;
  body: string;
  frontmatter: TaskBriefFrontmatter;
}

export interface TaskPivotEvent {
  type: 'task.pivot';
  taskId: string;
  nextStatus: 'UPDATED';
  contentHash: string;
  changedFields: string[];
  frontmatter: TaskBriefFrontmatter;
  body: string;
}

export interface TaskBriefWatcherOptions {
  baseDir?: string;
  debounceMs?: number;
}

interface TaskState {
  contentHash: string;
  frontmatter: TaskBriefFrontmatter;
  body: string;
}

function normalizeArrayField(val: string[] | string | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return [...val].sort();
  return [val].sort();
}

function areFieldValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const arrA = normalizeArrayField(a as string[] | string | undefined);
    const arrB = normalizeArrayField(b as string[] | string | undefined);
    if (arrA.length !== arrB.length) return false;
    return arrA.every((item, i) => item === arrB[i]);
  }
  return a === b;
}

export class TaskBriefWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private baseDir: string;
  private debounceMs: number;
  private knownStates: Map<string, TaskState> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private suppressedHashes: Set<string> = new Set();

  constructor(options?: TaskBriefWatcherOptions) {
    super();
    this.baseDir = options?.baseDir
      ? path.resolve(options.baseDir)
      : path.resolve(process.cwd(), '.agents/tasks');
    this.debounceMs = options?.debounceMs ?? 200;
  }

  /**
   * Records a programmatic (orchestrator-initiated) write to suppress self-write event loops.
   */
  public recordProgrammaticWrite(
    taskId: string,
    contentHash: string,
    frontmatter?: TaskBriefFrontmatter,
    body?: string
  ): void {
    this.suppressedHashes.add(contentHash);
    const existing = this.knownStates.get(taskId);
    this.knownStates.set(taskId, {
      contentHash,
      frontmatter: frontmatter ?? existing?.frontmatter ?? {},
      body: body ?? existing?.body ?? '',
    });
  }

  /**
   * Starts watching for brief.md additions and modifications.
   */
  public async start(): Promise<void> {
    const watchPattern = path.join(this.baseDir, '**', 'brief.md');

    this.watcher = chokidar.watch(watchPattern, {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: 20,
      },
    });

    this.watcher.on('add', (filePath: string) => this.scheduleProcessFile(filePath));
    this.watcher.on('change', (filePath: string) => this.scheduleProcessFile(filePath));

    // Wait until watcher is ready
    await new Promise<void>((resolve) => {
      if (!this.watcher) return resolve();
      this.watcher.on('ready', () => resolve());
    });
  }

  private scheduleProcessFile(filePath: string): void {
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      void this.processFile(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const contentHash = computeSha256(content);

      // Extract taskId from directory name (e.g. .agents/tasks/<taskId>/brief.md)
      const taskDir = path.dirname(filePath);
      const taskId = path.basename(taskDir);

      // If this write was programmatically initiated and matches the suppressed hash, skip and clear
      if (this.suppressedHashes.has(contentHash)) {
        this.suppressedHashes.delete(contentHash);
        return;
      }

      const parsed = matter(content);
      const currentFrontmatter = (parsed.data || {}) as TaskBriefFrontmatter;
      const currentBody = parsed.content || '';

      const lastState = this.knownStates.get(taskId);

      // If no state change in hash, skip
      if (lastState && lastState.contentHash === contentHash) {
        return;
      }

      if (!lastState) {
        // Initial baseline registration (first discovery)
        this.knownStates.set(taskId, {
          contentHash,
          frontmatter: currentFrontmatter,
          body: currentBody,
        });
        return;
      }

      // Check for scope/dependency pivot fields
      const criticalFields: string[] = [
        'writableScope',
        'blockedBy',
        'targetFiles',
      ];
      const changedFields: string[] = [];

      for (const field of criticalFields) {
        if (!areFieldValuesEqual(lastState.frontmatter[field], currentFrontmatter[field])) {
          changedFields.push(field);
        }
      }

      // Update stored state
      this.knownStates.set(taskId, {
        contentHash,
        frontmatter: currentFrontmatter,
        body: currentBody,
      });

      if (changedFields.length > 0) {
        const pivotEvent: TaskPivotEvent = {
          type: 'task.pivot',
          taskId,
          nextStatus: 'UPDATED',
          contentHash,
          changedFields,
          frontmatter: currentFrontmatter,
          body: currentBody,
        };
        this.emit('task.pivot', pivotEvent);
      } else {
        const injectEvent: TaskInjectEvent = {
          type: 'task.inject',
          taskId,
          contentHash,
          body: currentBody,
          frontmatter: currentFrontmatter,
        };
        this.emit('task.inject', injectEvent);
      }
    } catch {
      // Ignore reading errors if file was deleted during processing
    }
  }

  /**
   * Closes the watcher and cancels all active debounce timers.
   */
  public async close(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import Docker, { ContainerCreateOptions } from 'dockerode';
import { IRunnerProvider, TaskSandboxOptions } from './IRunnerProvider';
import { GraywolfAppError } from '../errors/taxonomy';
import { env } from '../config/env';

export interface HardenedSandboxOptions extends TaskSandboxOptions {
  projectId?: string;
  worktreePath?: string;
  parentGitDir?: string;
  pkgCacheDir?: string;
  relayDir?: string;
  memoryBytes?: number;
}

export interface DockerRunnerProviderOptions {
  dockerClient?: Docker;
  dockerHost?: string;
  networkMode?: string;
  seccompProfilePath?: string;
  defaultMemoryBytes?: number;
}

const DEFAULT_SECCOMP_PROFILE = JSON.stringify({
  defaultAction: 'SCMP_ACT_ALLOW',
  architectures: [
    'SCMP_ARCH_X86_64',
    'SCMP_ARCH_X86',
    'SCMP_ARCH_AARCH64',
  ],
  syscalls: [
    {
      names: [
        'ptrace',
        'bpf',
        'chroot',
        'mount',
        'umount2',
        'unshare',
        'setns',
        'kexec_load',
        'init_module',
      ],
      action: 'SCMP_ACT_ERRNO',
      args: [],
    },
  ],
});

export class DockerRunnerProvider implements IRunnerProvider {
  public readonly docker: Docker;
  public readonly networkMode: string;
  public readonly seccompProfilePath: string;
  public readonly defaultMemoryBytes: number;
  private readonly activeContainers = new Map<string, string>();

  constructor(options?: DockerRunnerProviderOptions) {
    if (options?.dockerClient) {
      this.docker = options.dockerClient;
    } else {
      const hostStr = options?.dockerHost ?? env.DOCKER_HOST ?? 'tcp://localhost:2375';
      this.docker = DockerRunnerProvider.createDockerClient(hostStr);
    }

    this.networkMode = options?.networkMode ?? env.RUNNER_DOCKER_NETWORK ?? 'graywolf-squad_runner-net';
    this.seccompProfilePath = options?.seccompProfilePath ?? path.resolve(process.cwd(), 'config/seccomp.json');
    this.defaultMemoryBytes = options?.defaultMemoryBytes ?? 4 * 1024 * 1024 * 1024;
  }

  private static createDockerClient(hostStr: string): Docker {
    if (hostStr.startsWith('tcp://')) {
      const parsed = new URL(hostStr.replace(/^tcp:\/\//, 'http://'));
      return new Docker({
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 2375,
        protocol: 'http',
      });
    }

    if (hostStr.startsWith('http://') || hostStr.startsWith('https://')) {
      const parsed = new URL(hostStr);
      return new Docker({
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
        protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
      });
    }

    if (hostStr.startsWith('unix://')) {
      return new Docker({ socketPath: hostStr.replace(/^unix:\/\//, '') });
    }

    if (hostStr.startsWith('/')) {
      return new Docker({ socketPath: hostStr });
    }

    return new Docker({ host: hostStr });
  }

  private getSeccompProfileString(): string {
    try {
      if (fs.existsSync(this.seccompProfilePath)) {
        const raw = fs.readFileSync(this.seccompProfilePath, 'utf8');
        return JSON.stringify(JSON.parse(raw));
      }
    } catch {
      // Fallback to default bundled seccomp json string
    }
    return DEFAULT_SECCOMP_PROFILE;
  }

  public buildContainerCreateOptions(
    options: HardenedSandboxOptions
  ): ContainerCreateOptions {
    const sanitizedId = options.taskId.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
    const containerName = `gw-task-${sanitizedId}`;
    const seccompCompact = this.getSeccompProfileString();

    const envArray: string[] = [];
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        envArray.push(`${key}=${value}`);
      }
    }

    const binds: string[] = [];
    if (options.worktreePath) {
      binds.push(`${path.resolve(options.worktreePath)}:/workspace:rw`);
    }
    if (options.parentGitDir) {
      const resolvedParent = path.resolve(options.parentGitDir);
      binds.push(`${resolvedParent}:${resolvedParent}:ro`);
    }
    const pkgCache = options.pkgCacheDir
      ? path.resolve(options.pkgCacheDir)
      : `pkg-cache-${(options.projectId ?? 'default').replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
    binds.push(`${pkgCache}:/home/graywolf/.npm:rw`);

    const relayPath = path.resolve(options.relayDir ?? 'src/relay');
    binds.push(`${relayPath}:/relay:ro`);

    if (options.bindMounts) {
      for (const m of options.bindMounts) {
        const mode = m.readonly ? 'ro' : 'rw';
        binds.push(`${path.resolve(m.source)}:${m.target}:${mode}`);
      }
    }

    // Deduplicate binds by destination target
    const seenTargets = new Set<string>();
    const deduplicatedBinds: string[] = [];
    for (const b of binds) {
      const parts = b.split(':');
      const target = parts[1];
      if (!seenTargets.has(target)) {
        seenTargets.add(target);
        deduplicatedBinds.push(b);
      }
    }

    const memory = options.memoryBytes ?? this.defaultMemoryBytes;
    const network = options.networkMode ?? this.networkMode;

    const createOpts: ContainerCreateOptions = {
      name: containerName,
      Image: options.image || 'graywolf-runner:latest',
      User: '10001:10001',
      Cmd: options.command ?? ['node', '/relay/relay.mjs'],
      Env: envArray,
      Labels: {
        'graywolf.managed': 'true',
        'graywolf.taskId': options.taskId,
      },
      HostConfig: {
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: [
          'no-new-privileges:true',
          `seccomp=${seccompCompact}`,
        ],
        NetworkMode: network,
        Memory: memory,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=512m',
          '/scratch/spill': 'rw,noexec,nodev,size=2g',
        },
        Binds: deduplicatedBinds,
      },
    };

    return createOpts;
  }

  public async startSandbox(
    options: HardenedSandboxOptions
  ): Promise<{ containerId: string }> {
    try {
      const createOpts = this.buildContainerCreateOptions(options);
      const container = await this.docker.createContainer(createOpts);
      await container.start();
      this.activeContainers.set(options.taskId, container.id);
      return { containerId: container.id };
    } catch (err: unknown) {
      const error = err as Error & { code?: string; statusCode?: number };
      const msg = error?.message || String(err);
      const code = error?.code || '';
      if (
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOENT') ||
        msg.includes('EHOSTUNREACH') ||
        code === 'ECONNREFUSED' ||
        code === 'ENOENT' ||
        code === 'EHOSTUNREACH'
      ) {
        throw new GraywolfAppError(
          'SANDBOX_DOCKER_PROXY_UNREACHABLE',
          `Docker socket proxy is unreachable: ${msg}`,
          { taskId: options.taskId, originalError: msg, code }
        );
      }

      throw new GraywolfAppError(
        'SANDBOX_PROVISIONING_FAILED',
        `Failed to provision runner container for task '${options.taskId}': ${msg}`,
        { taskId: options.taskId, originalError: msg, code }
      );
    }
  }

  public async teardownSandbox(taskId: string): Promise<void> {
    const containerId = this.activeContainers.get(taskId);
    const container = containerId
      ? this.docker.getContainer(containerId)
      : this.docker.getContainer(`gw-task-${taskId.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`);

    try {
      await container.remove({ force: true, v: true });
    } catch (err: unknown) {
      const error = err as Error & { statusCode?: number };
      const is404 =
        error?.statusCode === 404 ||
        (error?.message && error.message.toLowerCase().includes('no such container'));
      if (!is404) {
        throw err;
      }
    } finally {
      this.activeContainers.delete(taskId);
    }
  }

  public async waitForExit(taskId: string): Promise<number> {
    const containerId = this.activeContainers.get(taskId);
    const container = containerId
      ? this.docker.getContainer(containerId)
      : this.docker.getContainer(`gw-task-${taskId.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`);

    const res = await container.wait();
    const statusCode = res?.StatusCode ?? 0;
    if (statusCode === 137) {
      throw new GraywolfAppError(
        'SANDBOX_OOM_KILLED',
        `Container for task '${taskId}' was killed due to Out-Of-Memory (exit code 137)`,
        { taskId, exitCode: 137 }
      );
    }
    return statusCode;
  }

  public async pruneDanglingTaskContainers(): Promise<string[]> {
    const containers = await this.docker.listContainers({ all: true });
    const removed: string[] = [];
    for (const info of containers) {
      const isManaged = info.Labels?.['graywolf.managed'] === 'true';
      const hasPrefix = info.Names?.some(
        (n) => n.startsWith('/gw-task-') || n.startsWith('gw-task-')
      );
      if (isManaged || hasPrefix) {
        try {
          const container = this.docker.getContainer(info.Id);
          await container.remove({ force: true, v: true });
          removed.push(info.Names?.[0] || info.Id);
        } catch (err: unknown) {
          const error = err as Error & { statusCode?: number };
          if (error?.statusCode !== 404) {
            // Ignore non-fatal cleanup errors
          }
        }
      }
    }
    return removed;
  }
}

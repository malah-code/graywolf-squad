import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Docker from 'dockerode';
import { DockerRunnerProvider } from '../../src/orchestrator/runner/docker';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('Hardened DockerRunnerProvider', () => {
  const seccompPath = path.resolve(process.cwd(), 'config/seccomp.json');
  const dockerfilePath = path.resolve(process.cwd(), 'docker/runner/Dockerfile');
  const egressScriptPath = path.resolve(process.cwd(), 'scripts/egress-rules.sh');

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Seccomp Profile Validation', () => {
    it('parses config/seccomp.json and enforces SCMP_ACT_ERRNO on 9 forbidden syscalls', () => {
      expect(fs.existsSync(seccompPath)).toBe(true);
      const raw = fs.readFileSync(seccompPath, 'utf8');
      const profile = JSON.parse(raw);

      expect(profile.defaultAction).toBe('SCMP_ACT_ALLOW');
      expect(profile.architectures).toEqual(
        expect.arrayContaining(['SCMP_ARCH_X86_64', 'SCMP_ARCH_X86', 'SCMP_ARCH_AARCH64'])
      );

      const syscallRule = profile.syscalls.find(
        (s: { action: string }) => s.action === 'SCMP_ACT_ERRNO'
      );
      expect(syscallRule).toBeDefined();

      const requiredDeniedSyscalls = [
        'ptrace',
        'bpf',
        'chroot',
        'mount',
        'umount2',
        'unshare',
        'setns',
        'kexec_load',
        'init_module',
      ];

      for (const syscall of requiredDeniedSyscalls) {
        expect(syscallRule.names).toContain(syscall);
      }
    });
  });

  describe('buildContainerCreateOptions', () => {
    it('configures hardened non-root container options with readonly rootfs, dropped capabilities, and mandatory binds', () => {
      const provider = new DockerRunnerProvider({
        seccompProfilePath: seccompPath,
        networkMode: 'graywolf-squad_runner-net',
      });

      const options = provider.buildContainerCreateOptions({
        taskId: 'TASK-101',
        projectId: 'proj-omega',
        image: 'graywolf-runner:latest',
        worktreePath: '/tmp/worktree/task-101',
        parentGitDir: '/home/graywolf/repo/.git',
        pkgCacheDir: '/tmp/pkg-cache',
        relayDir: '/tmp/relay-harness',
        env: { NODE_ENV: 'test', TASK_ID: 'TASK-101' },
        command: ['node', '/relay/relay.mjs', '--task=TASK-101'],
      });

      expect(options.name).toBe('gw-task-task-101');
      expect(options.User).toBe('10001:10001');
      expect(options.Image).toBe('graywolf-runner:latest');
      expect(options.Cmd).toEqual(['node', '/relay/relay.mjs', '--task=TASK-101']);
      expect(options.Env).toEqual(
        expect.arrayContaining(['NODE_ENV=test', 'TASK_ID=TASK-101'])
      );
      expect(options.Labels).toEqual({
        'graywolf.managed': 'true',
        'graywolf.taskId': 'TASK-101',
      });

      const hostConfig = options.HostConfig!;
      expect(hostConfig.ReadonlyRootfs).toBe(true);
      expect(hostConfig.CapDrop).toEqual(['ALL']);
      expect(hostConfig.NetworkMode).toBe('graywolf-squad_runner-net');
      expect(hostConfig.Memory).toBe(4 * 1024 * 1024 * 1024);

      // SecurityOpt must include no-new-privileges and seccomp profile
      expect(hostConfig.SecurityOpt).toEqual(
        expect.arrayContaining([
          'no-new-privileges:true',
          expect.stringMatching(/^seccomp=\{"defaultAction":"SCMP_ACT_ALLOW"/),
        ])
      );

      // Tmpfs mounts
      expect(hostConfig.Tmpfs).toEqual({
        '/tmp': 'rw,noexec,nosuid,size=512m',
        '/scratch/spill': 'rw,noexec,nodev,size=2g',
      });

      // Bind mounts
      const binds = hostConfig.Binds!;
      expect(binds).toEqual(
        expect.arrayContaining([
          expect.stringContaining(':/workspace:rw'),
          expect.stringContaining('/.git:ro'),
          expect.stringContaining(':/home/graywolf/.npm:rw'),
          expect.stringContaining(':/relay:ro'),
        ])
      );
    });
  });

  describe('startSandbox & Docker socket proxy handling', () => {
    it('creates and starts a container returning containerId', async () => {
      const mockContainer = {
        id: 'mock-container-id-12345',
        start: vi.fn().mockResolvedValue(undefined),
      };

      const mockDocker = {
        createContainer: vi.fn().mockResolvedValue(mockContainer),
      } as unknown as Docker;

      const provider = new DockerRunnerProvider({ dockerClient: mockDocker });
      const result = await provider.startSandbox({
        taskId: 'TASK-102',
        image: 'graywolf-runner:latest',
      });

      expect(result.containerId).toBe('mock-container-id-12345');
      expect(mockDocker.createContainer).toHaveBeenCalledOnce();
      expect(mockContainer.start).toHaveBeenCalledOnce();
    });

    it('maps ECONNREFUSED to SANDBOX_DOCKER_PROXY_UNREACHABLE (HTTP 503)', async () => {
      const mockDocker = {
        createContainer: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:2375')),
      } as unknown as Docker;

      const provider = new DockerRunnerProvider({ dockerClient: mockDocker });

      await expect(
        provider.startSandbox({
          taskId: 'TASK-103',
          image: 'graywolf-runner:latest',
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(GraywolfAppError);
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('SANDBOX_DOCKER_PROXY_UNREACHABLE');
        expect(appErr.httpStatus).toBe(503);
        return true;
      });
    });

    it('maps daemon failure to SANDBOX_PROVISIONING_FAILED (HTTP 500)', async () => {
      const mockDocker = {
        createContainer: vi.fn().mockRejectedValue(new Error('image not found')),
      } as unknown as Docker;

      const provider = new DockerRunnerProvider({ dockerClient: mockDocker });

      await expect(
        provider.startSandbox({
          taskId: 'TASK-104',
          image: 'graywolf-runner:latest',
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(GraywolfAppError);
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('SANDBOX_PROVISIONING_FAILED');
        expect(appErr.httpStatus).toBe(500);
        return true;
      });
    });
  });

  describe('waitForExit & teardownSandbox', () => {
    it('returns exit code for successful process termination', async () => {
      const mockContainer = {
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      } as unknown as Docker;

      const provider = new DockerRunnerProvider({ dockerClient: mockDocker });
      const code = await provider.waitForExit('TASK-105');
      expect(code).toBe(0);
    });

    it('throws SANDBOX_OOM_KILLED when exit code is 137', async () => {
      const mockContainer = {
        wait: vi.fn().mockResolvedValue({ StatusCode: 137 }),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      } as unknown as Docker;

      const provider = new DockerRunnerProvider({ dockerClient: mockDocker });

      await expect(provider.waitForExit('TASK-106')).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(GraywolfAppError);
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('SANDBOX_OOM_KILLED');
        expect(appErr.httpStatus).toBe(500);
        return true;
      });
    });

    it('removes container cleanly during teardownSandbox ignoring 404', async () => {
      const mockContainer = {
        remove: vi.fn().mockRejectedValue({ statusCode: 404, message: 'no such container' }),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      } as unknown as Docker;

      const provider = new DockerRunnerProvider({ dockerClient: mockDocker });
      await expect(provider.teardownSandbox('TASK-107')).resolves.toBeUndefined();
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true, v: true });
    });

    it('prunes dangling gw-task containers in pruneDanglingTaskContainers', async () => {
      const mockRemove = vi.fn().mockResolvedValue(undefined);
      const mockDocker = {
        listContainers: vi.fn().mockResolvedValue([
          { Id: 'c1', Names: ['/gw-task-abc'], Labels: { 'graywolf.managed': 'true' } },
          { Id: 'c2', Names: ['/postgres-main'], Labels: {} },
        ]),
        getContainer: vi.fn().mockReturnValue({ remove: mockRemove }),
      } as unknown as Docker;

      const provider = new DockerRunnerProvider({ dockerClient: mockDocker });
      const pruned = await provider.pruneDanglingTaskContainers();

      expect(pruned).toEqual(['/gw-task-abc']);
      expect(mockDocker.getContainer).toHaveBeenCalledWith('c1');
      expect(mockRemove).toHaveBeenCalledWith({ force: true, v: true });
    });
  });

  describe('User Story 3: Egress Firewall & Dockerfile Verification', () => {
    it('verifies scripts/egress-rules.sh syntax with bash -n and tests --dry-run rules', () => {
      expect(fs.existsSync(egressScriptPath)).toBe(true);

      // Bash syntax check
      expect(() => {
        execSync(`bash -n "${egressScriptPath}"`, { stdio: 'pipe' });
      }).not.toThrow();

      // Dry run execution
      const dryRunOutput = execSync(`bash "${egressScriptPath}" --dry-run`, {
        encoding: 'utf8',
      });

      expect(dryRunOutput).toContain('DOCKER-USER');
      expect(dryRunOutput).toContain('3001'); // ARP WebSocket
      expect(dryRunOutput).toContain('4000'); // LiteLLM Gateway
      expect(dryRunOutput).toContain('443'); // HTTPS
      expect(dryRunOutput).toContain('3000 -j DROP'); // Control plane DROP
      expect(dryRunOutput).toContain('5432 -j DROP'); // PostgreSQL DROP
      expect(dryRunOutput).toContain('6379 -j DROP'); // Valkey DROP
      expect(dryRunOutput).toContain('-j DROP'); // Default DROP
    });

    it('verifies docker/runner/Dockerfile includes required tooling and non-root UID 10001', () => {
      expect(fs.existsSync(dockerfilePath)).toBe(true);
      const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

      expect(dockerfile).toContain('10001:10001');
      expect(dockerfile).toContain('playwright');
      expect(dockerfile).toContain('ripgrep');
      expect(dockerfile).toContain('ast-grep');
      expect(dockerfile).toContain('gitleaks');
      expect(dockerfile).toContain('osv-scanner');
    });
  });
});

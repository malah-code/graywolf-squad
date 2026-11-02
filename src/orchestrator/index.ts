import pino from 'pino';
import { env } from './config/env';
import { buildApp } from './app';
import { buildArpServer } from './arp/server';
import { pool } from './db';
import { seedSoloWorkspaceIfEmpty } from './auth/solo-seed';
import { pruneStaleResourcesOnBoot } from './runner/lock';
import { DockerRunnerProvider } from './runner/docker';
import { FastifyInstance } from 'fastify';

const logger = pino({
  name: 'orchestrator-main',
  level: process.env.LOG_LEVEL || 'info',
});

export interface StartServersOptions {
  portControl?: number;
  portArp?: number;
  host?: string;
  registerSignals?: boolean;
  exitOnFailure?: boolean;
  closePoolOnShutdown?: boolean;
  runBootHooks?: boolean;
}

export interface StartedServers {
  controlPlane: FastifyInstance;
  arpServer: FastifyInstance;
  controlAddress: string;
  arpAddress: string;
  shutdown: (signal?: string) => Promise<void>;
}

export async function startServers(
  options: StartServersOptions = {}
): Promise<StartedServers> {
  const portControl = options.portControl ?? env.PORT_CONTROL;
  const portArp = options.portArp ?? env.PORT_ARP;
  const host = options.host ?? '0.0.0.0';
  const registerSignals = options.registerSignals ?? true;
  const exitOnFailure = options.exitOnFailure ?? true;
  const closePoolOnShutdown = options.closePoolOnShutdown ?? true;
  const runBootHooks = options.runBootHooks ?? env.NODE_ENV !== 'test';

  if (runBootHooks) {
    try {
      const runnerProvider = new DockerRunnerProvider();
      await pruneStaleResourcesOnBoot({
        repoRoot: process.cwd(),
        teardownDanglingContainers: () => runnerProvider.pruneDanglingTaskContainers(),
      });
    } catch (gcErr) {
      logger.warn({ err: gcErr }, 'Startup garbage collection pass encountered a warning');
    }

    try {
      await seedSoloWorkspaceIfEmpty(pool);
    } catch (seedErr) {
      logger.warn({ err: seedErr }, 'Zero-Config Solo Mode startup seed skipped (DB offline)');
    }

    try {
      const runner = new DockerRunnerProvider();
      await runner.pruneDanglingTaskContainers();
    } catch (dockerErr) {
      logger.debug({ err: dockerErr }, 'Docker container cleanup on startup skipped');
    }
  }

  const controlPlane = buildApp({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  const arpServer = buildArpServer({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  try {
    // 1. Start Control Plane (Port 3000 default)
    const controlAddress = await controlPlane.listen({
      port: portControl,
      host,
    });
    logger.info(`Control Plane REST API listening on ${controlAddress}`);

    // 2. Start ARP Server (Port 3001 default)
    let arpAddress: string;
    try {
      arpAddress = await arpServer.listen({
        port: portArp,
        host,
      });
      logger.info(`ARP WebSocket Server listening on ${arpAddress}/relay`);
    } catch (arpErr) {
      // Partial startup failure cleanup: close controlPlane before exiting/re-throwing
      logger.error(arpErr, 'ARP server failed to bind. Tearing down Control Plane...');
      await controlPlane.close();
      throw arpErr;
    }

    // 3. Graceful Shutdown Setup
    let isShuttingDown = false;
    let onSigInt: (() => void) | undefined;
    let onSigTerm: (() => void) | undefined;

    const shutdown = async (signal = 'MANUAL') => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.info(`Received ${signal}. Initiating graceful shutdown...`);

      if (onSigInt) process.removeListener('SIGINT', onSigInt);
      if (onSigTerm) process.removeListener('SIGTERM', onSigTerm);

      const timeout = setTimeout(() => {
        logger.error('Graceful shutdown timed out after 5s. Forcing exit.');
        if (exitOnFailure) {
          process.exit(1);
        }
      }, 5000);

      try {
        await Promise.allSettled([
          arpServer.close(),
          controlPlane.close(),
          closePoolOnShutdown ? pool.end() : Promise.resolve(),
        ]);
        clearTimeout(timeout);
        logger.info('Graceful shutdown complete.');
        if (exitOnFailure && signal !== 'TEST' && signal !== 'MANUAL') {
          process.exit(0);
        }
      } catch (err) {
        clearTimeout(timeout);
        logger.error(err, 'Error occurred during graceful shutdown');
        if (exitOnFailure) {
          process.exit(1);
        }
        throw err;
      }
    };

    if (registerSignals) {
      onSigInt = () => { void shutdown('SIGINT'); };
      onSigTerm = () => { void shutdown('SIGTERM'); };
      process.on('SIGINT', onSigInt);
      process.on('SIGTERM', onSigTerm);
    }

    return { controlPlane, arpServer, controlAddress, arpAddress, shutdown };
  } catch (err) {
    logger.fatal(err, 'Failed to initialize orchestrator listeners');
    await Promise.allSettled([
      controlPlane.close(),
      arpServer.close(),
    ]);
    if (exitOnFailure) {
      process.exit(1);
    }
    throw err;
  }
}

// Automatically start if executed as primary process
if (require.main === module) {
  startServers().catch((err) => {
    logger.fatal(err, 'Uncaught error in server start');
    process.exit(1);
  });
}

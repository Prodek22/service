import { env } from '../config/env';
import { getMaintenanceStatus, startMaintenanceJob } from './maintenanceJobService';

let timer: NodeJS.Timeout | null = null;

const triggerCleanup = () => {
  const current = getMaintenanceStatus();
  if (current.state === 'running') {
    console.log('[auto-cleanup] skipped because another maintenance job is running');
    return;
  }

  try {
    const status = startMaintenanceJob('cleanup-retention', {
      keepCycles: env.AUTO_CLEANUP_KEEP_CYCLES
    });
    console.log(
      `[auto-cleanup] started job ${status.id} (keepCycles=${env.AUTO_CLEANUP_KEEP_CYCLES}, interval=${env.AUTO_CLEANUP_INTERVAL_HOURS}h)`
    );
  } catch (error) {
    console.error('[auto-cleanup] failed to start cleanup job', error);
  }
};

export const startAutoCleanupScheduler = () => {
  if (!env.AUTO_CLEANUP_ENABLED) {
    console.log('[auto-cleanup] scheduler disabled');
    return;
  }

  if (env.AUTO_CLEANUP_RUN_ON_START) {
    triggerCleanup();
  }

  const intervalMs = Math.max(24, env.AUTO_CLEANUP_INTERVAL_HOURS) * 60 * 60 * 1000;
  timer = setInterval(() => {
    triggerCleanup();
  }, intervalMs);

  console.log(
    `[auto-cleanup] scheduler enabled: interval=${env.AUTO_CLEANUP_INTERVAL_HOURS}h, keepCycles=${env.AUTO_CLEANUP_KEEP_CYCLES}, runOnStart=${env.AUTO_CLEANUP_RUN_ON_START}`
  );
};

export const stopAutoCleanupScheduler = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

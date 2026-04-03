import { env } from '../config/env';
import { getMaintenanceStatus, startMaintenanceJob } from './maintenanceJobService';

let timer: NodeJS.Timeout | null = null;

const triggerTimesheetSync = () => {
  const current = getMaintenanceStatus();
  if (current.state === 'running') {
    console.log('[timesheet-sync] skipped because another maintenance job is running');
    return;
  }

  try {
    const status = startMaintenanceJob('sync-timesheet-window', { days: env.TIMESHEET_SYNC_DAYS });
    console.log(
      `[timesheet-sync] started job ${status.id} for last ${env.TIMESHEET_SYNC_DAYS} days (background worker)`
    );
  } catch (error) {
    console.error('[timesheet-sync] failed to start', error);
  }
};

export const startTimesheetSyncScheduler = () => {
  if (!env.TIMESHEET_DAILY_SYNC_ENABLED) {
    console.log('[timesheet-sync] scheduler disabled');
    return;
  }

  triggerTimesheetSync();

  const intervalMs = Math.max(1, env.TIMESHEET_SYNC_INTERVAL_HOURS) * 60 * 60 * 1000;
  timer = setInterval(() => {
    triggerTimesheetSync();
  }, intervalMs);

  console.log(
    `[timesheet-sync] scheduler enabled: interval=${env.TIMESHEET_SYNC_INTERVAL_HOURS}h, window=${env.TIMESHEET_SYNC_DAYS}d`
  );
};

export const stopTimesheetSyncScheduler = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

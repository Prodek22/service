import { env } from '../config/env';
import { runBackfill } from './backfillRunner';

let timer: NodeJS.Timeout | null = null;

const runTimesheetSync = async () => {
  const sinceDate = new Date(Date.now() - env.TIMESHEET_SYNC_DAYS * 24 * 60 * 60 * 1000);

  try {
    const result = await runBackfill({
      mode: 'since',
      sinceDate,
      channels: ['timesheet']
    });

    console.log(
      `[timesheet-sync] completed for last ${env.TIMESHEET_SYNC_DAYS} days. Processed: ${result.timesheetProcessed}`
    );
  } catch (error) {
    console.error('[timesheet-sync] failed', error);
  }
};

export const startTimesheetSyncScheduler = () => {
  if (!env.TIMESHEET_DAILY_SYNC_ENABLED) {
    console.log('[timesheet-sync] scheduler disabled');
    return;
  }

  void runTimesheetSync();

  const intervalMs = Math.max(1, env.TIMESHEET_SYNC_INTERVAL_HOURS) * 60 * 60 * 1000;
  timer = setInterval(() => {
    void runTimesheetSync();
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

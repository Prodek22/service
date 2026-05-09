import { env } from '../config/env';
import { warmTimesheetSummaryCache } from './timesheetSummaryService';

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

const runWarmCycle = async () => {
  if (isRunning) {
    return;
  }

  isRunning = true;
  try {
    const result = await warmTimesheetSummaryCache(env.TIMESHEET_WARM_CACHE_CYCLES);
    console.log(
      `[timesheet-warm-cache] warmed=${result.warmed}, skippedOpen=${result.skippedOpen}, failed=${result.failed}`
    );
  } catch (error) {
    console.error('[timesheet-warm-cache] failed', error);
  } finally {
    isRunning = false;
  }
};

export const startTimesheetWarmCacheScheduler = () => {
  if (!env.TIMESHEET_WARM_CACHE_ENABLED) {
    console.log('[timesheet-warm-cache] scheduler disabled');
    return;
  }

  void runWarmCycle();

  const intervalMs = Math.max(10, env.TIMESHEET_WARM_CACHE_INTERVAL_SECONDS) * 1000;
  timer = setInterval(() => {
    void runWarmCycle();
  }, intervalMs);

  console.log(
    `[timesheet-warm-cache] scheduler enabled: interval=${env.TIMESHEET_WARM_CACHE_INTERVAL_SECONDS}s, cycles=${env.TIMESHEET_WARM_CACHE_CYCLES}`
  );
};

export const stopTimesheetWarmCacheScheduler = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

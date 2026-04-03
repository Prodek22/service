import { runBackfill } from '../services/backfillRunner';

const run = async () => {
  console.log('[backfill] Starting full channel replay...');
  const result = await runBackfill({ mode: 'all' });
  console.log(`[backfill] Completed. CV processed: ${result.cvProcessed}, timesheet processed: ${result.timesheetProcessed}`);
};

run().catch((error) => {
  console.error('[backfill] failed', error);
  process.exit(1);
});

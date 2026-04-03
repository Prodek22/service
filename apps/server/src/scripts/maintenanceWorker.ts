import { prisma } from '../db/prisma';
import { runBackfill } from '../services/backfillRunner';

type WorkerInput = {
  id: string;
  type: 'sync-new' | 'sync-timesheet-window' | 'rebuild-all';
  payload?: {
    latestLimitPerChannel?: number;
    days?: number;
  };
};

const getInput = (): WorkerInput => {
  const raw = process.env.MAINTENANCE_JOB_INPUT;
  if (!raw) {
    throw new Error('Missing MAINTENANCE_JOB_INPUT');
  }

  return JSON.parse(raw) as WorkerInput;
};

const run = async () => {
  const input = getInput();

  if (input.type === 'sync-new') {
    const latestLimitPerChannel = Math.max(1, Math.min(input.payload?.latestLimitPerChannel ?? 100, 100));
    const result = await runBackfill({
      mode: 'latest',
      latestLimitPerChannel
    });

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'latest',
        latestLimitPerChannel,
        processed: result
      }
    });

    return;
  }

  if (input.type === 'sync-timesheet-window') {
    const days = Math.max(1, Math.min(input.payload?.days ?? 14, 90));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await runBackfill({
      mode: 'since',
      sinceDate,
      channels: ['timesheet']
    });

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'since',
        days,
        processed: result
      }
    });

    return;
  }

  if (input.type === 'rebuild-all') {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE time_events');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE week_cycles');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employee_cv_raw');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employee_aliases');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employees');
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');

    const result = await runBackfill({ mode: 'all' });

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'all',
        deleted: 'all-operational-data',
        processed: result
      }
    });

    return;
  }

  throw new Error(`Unsupported maintenance job type: ${input.type}`);
};

run()
  .catch(async (error) => {
    try {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    } catch {
      // noop
    }

    process.send?.({
      type: 'job-failed',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown worker error'
      }
    });

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { Response, Router } from 'express';
import { prisma } from '../db/prisma';
import { runBackfill } from '../services/backfillRunner';

let syncInProgress = false;

export const maintenanceRouter = Router();

const ensureSingleMaintenanceRun = (res: Response): boolean => {
  if (syncInProgress) {
    res.status(409).json({ error: 'Maintenance already in progress.' });
    return false;
  }

  syncInProgress = true;
  return true;
};

maintenanceRouter.post('/delete-old', async (req, res) => {
  const input = Number.parseInt(String(req.body?.olderThanDays ?? '90'), 10);
  const olderThanDays = Number.isNaN(input) ? 90 : Math.max(1, Math.min(input, 3650));
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const [timeEventsResult, weekCyclesResult, employeesResult] = await prisma.$transaction([
    prisma.timeEvent.deleteMany({
      where: {
        eventAt: {
          lt: cutoff
        }
      }
    }),
    prisma.weekCycle.deleteMany({
      where: {
        startedAt: {
          lt: cutoff
        },
        timeEvents: {
          none: {}
        }
      }
    }),
    prisma.employee.deleteMany({
      where: {
        createdAt: {
          lt: cutoff
        }
      }
    })
  ]);

  res.json({
    ok: true,
    olderThanDays,
    deleted: {
      timeEvents: timeEventsResult.count,
      weekCycles: weekCyclesResult.count,
      employees: employeesResult.count
    }
  });
});

maintenanceRouter.post('/sync-new', async (req, res) => {
  if (!ensureSingleMaintenanceRun(res)) {
    return;
  }

  const input = Number.parseInt(String(req.body?.latestLimitPerChannel ?? '100'), 10);
  const latestLimitPerChannel = Number.isNaN(input) ? 100 : Math.max(1, Math.min(input, 100));

  try {
    const result = await runBackfill({
      mode: 'latest',
      latestLimitPerChannel
    });

    res.json({
      ok: true,
      latestLimitPerChannel,
      processed: result
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Sync failed' });
  } finally {
    syncInProgress = false;
  }
});

maintenanceRouter.post('/rebuild-all', async (_req, res) => {
  if (!ensureSingleMaintenanceRun(res)) {
    return;
  }

  try {
    // Full data reset for operational tables, preserving admin auth users and migration metadata.
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE time_events');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE week_cycles');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employee_cv_raw');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employee_aliases');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employees');
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');

    const result = await runBackfill({ mode: 'all' });

    res.json({
      ok: true,
      deleted: {
        employees: 'all',
        employeeCvRaw: 'all',
        employeeAliases: 'all',
        weekCycles: 'all',
        timeEvents: 'all'
      },
      processed: result
    });
  } catch (error) {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Full rebuild failed' });
  } finally {
    syncInProgress = false;
  }
});

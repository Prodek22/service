import { Router } from 'express';
import { prisma } from '../db/prisma';
import { runBackfill } from '../services/backfillRunner';

let syncInProgress = false;

export const maintenanceRouter = Router();

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
  if (syncInProgress) {
    res.status(409).json({ error: 'Sync already in progress.' });
    return;
  }

  const input = Number.parseInt(String(req.body?.latestLimitPerChannel ?? '100'), 10);
  const latestLimitPerChannel = Number.isNaN(input) ? 100 : Math.max(1, Math.min(input, 100));

  syncInProgress = true;

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
  } finally {
    syncInProgress = false;
  }
});

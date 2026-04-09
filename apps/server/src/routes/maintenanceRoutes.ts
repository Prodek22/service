import { Router } from 'express';
import { prisma } from '../db/prisma';
import { recordAuditLog } from '../services/auditLogService';
import { getMaintenanceStatus, startMaintenanceJob } from '../services/maintenanceJobService';

export const maintenanceRouter = Router();

maintenanceRouter.get('/job-status', (_req, res) => {
  res.json(getMaintenanceStatus());
});

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

  await recordAuditLog({
    req,
    res,
    action: 'MAINTENANCE_DELETE_OLD',
    entityType: 'maintenance',
    metadata: {
      olderThanDays,
      deleted: {
        timeEvents: timeEventsResult.count,
        weekCycles: weekCyclesResult.count,
        employees: employeesResult.count
      }
    }
  });

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

maintenanceRouter.post('/sync-new', (req, res) => {
  try {
    const input = Number.parseInt(String(req.body?.latestLimitPerChannel ?? '100'), 10);
    const latestLimitPerChannel = Number.isNaN(input) ? 100 : Math.max(1, Math.min(input, 100));

    const status = startMaintenanceJob('sync-new', { latestLimitPerChannel });

    void recordAuditLog({
      req,
      res,
      action: 'MAINTENANCE_SYNC_NEW',
      entityType: 'maintenance_job',
      entityId: status.id,
      metadata: {
        latestLimitPerChannel,
        type: 'sync-new'
      }
    });

    res.status(202).json({
      ok: true,
      message: 'Sync new started',
      job: status
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Could not start sync-new job' });
  }
});

maintenanceRouter.post('/sync-employees-incremental', (req, res) => {
  try {
    const input = Number.parseInt(String(req.body?.lookbackDays ?? '14'), 10);
    const lookbackDays = Number.isNaN(input) ? 14 : Math.max(1, Math.min(input, 60));

    const status = startMaintenanceJob('sync-employees-incremental', { lookbackDays });

    void recordAuditLog({
      req,
      res,
      action: 'MAINTENANCE_SYNC_EMPLOYEES_INCREMENTAL',
      entityType: 'maintenance_job',
      entityId: status.id,
      metadata: {
        lookbackDays,
        type: 'sync-employees-incremental'
      }
    });

    res.status(202).json({
      ok: true,
      message: 'Incremental employee sync started',
      job: status
    });
  } catch (error) {
    res
      .status(409)
      .json({ error: error instanceof Error ? error.message : 'Could not start incremental employee sync job' });
  }
});

maintenanceRouter.post('/sync-timesheet-window', (req, res) => {
  try {
    const input = Number.parseInt(String(req.body?.days ?? '14'), 10);
    const days = Number.isNaN(input) ? 14 : Math.max(1, Math.min(input, 90));

    const status = startMaintenanceJob('sync-timesheet-window', { days });

    void recordAuditLog({
      req,
      res,
      action: 'MAINTENANCE_SYNC_TIMESHEET_WINDOW',
      entityType: 'maintenance_job',
      entityId: status.id,
      metadata: {
        days,
        type: 'sync-timesheet-window'
      }
    });

    res.status(202).json({
      ok: true,
      message: 'Timesheet window sync started',
      job: status
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Could not start timesheet sync job' });
  }
});

maintenanceRouter.post('/rebuild-all', (req, res) => {
  try {
    const status = startMaintenanceJob('rebuild-all');

    void recordAuditLog({
      req,
      res,
      action: 'MAINTENANCE_REBUILD_ALL',
      entityType: 'maintenance_job',
      entityId: status.id,
      metadata: {
        type: 'rebuild-all'
      }
    });

    res.status(202).json({
      ok: true,
      message: 'Full rebuild started',
      job: status
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Could not start rebuild job' });
  }
});

maintenanceRouter.post('/rebuild-cv-all', (req, res) => {
  try {
    const status = startMaintenanceJob('rebuild-cv-all');

    void recordAuditLog({
      req,
      res,
      action: 'MAINTENANCE_REBUILD_CV_ALL',
      entityType: 'maintenance_job',
      entityId: status.id,
      metadata: {
        type: 'rebuild-cv-all'
      }
    });

    res.status(202).json({
      ok: true,
      message: 'Full CV rebuild started',
      job: status
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Could not start CV rebuild job' });
  }
});

maintenanceRouter.post('/cleanup-retention', (req, res) => {
  try {
    const input = Number.parseInt(String(req.body?.keepCycles ?? ''), 10);
    const keepCycles = Number.isNaN(input) ? undefined : Math.max(6, Math.min(input, 260));

    const status = startMaintenanceJob('cleanup-retention', {
      ...(keepCycles ? { keepCycles } : {})
    });

    void recordAuditLog({
      req,
      res,
      action: 'MAINTENANCE_CLEANUP_RETENTION',
      entityType: 'maintenance_job',
      entityId: status.id,
      metadata: {
        type: 'cleanup-retention',
        keepCycles: keepCycles ?? null
      }
    });

    res.status(202).json({
      ok: true,
      message: 'Cleanup retention started',
      job: status
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Could not start cleanup job' });
  }
});


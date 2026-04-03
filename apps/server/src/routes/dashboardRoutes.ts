import { EmployeeStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db/prisma';
import { getCycleTotals } from '../services/timesheetService';
import { secondsToHm } from '../utils/time';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (_req, res) => {
  const [activeEmployees, incompleteCvs, latestCycle] = await Promise.all([
    prisma.employee.count({
      where: {
        status: EmployeeStatus.ACTIVE,
        deletedAt: null
      }
    }),
    prisma.employee.count({
      where: {
        status: EmployeeStatus.INCOMPLETE,
        deletedAt: null
      }
    }),
    prisma.weekCycle.findFirst({
      orderBy: {
        startedAt: 'desc'
      }
    })
  ]);

  const totals = latestCycle ? await getCycleTotals(latestCycle.id) : [];

  const totalWeekSeconds = totals.reduce((sum, entry) => sum + entry.totalSeconds, 0);

  res.json({
    currentCycleId: latestCycle?.id ?? null,
    totalActiveEmployees: activeEmployees,
    totalIncompleteCvs: incompleteCvs,
    totalWeekSeconds,
    totalWeekLabel: secondsToHm(totalWeekSeconds),
    topEmployees: totals.slice(0, 5).map((entry) => ({
      ...entry,
      totalLabel: secondsToHm(entry.totalSeconds)
    }))
  });
});


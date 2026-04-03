import { EmployeeStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db/prisma';
import { getCycleTotals } from '../services/timesheetService';
import { secondsToHm } from '../utils/time';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (_req, res) => {
  const [activeEmployees, incompleteCvs, latestCycles] = await Promise.all([
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
    prisma.weekCycle.findMany({
      where: {
        resetMessageId: {
          not: null
        }
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: 8
    })
  ]);

  const currentCycle = latestCycles.find((cycle) => cycle.endedAt === null) ?? latestCycles[0] ?? null;
  const previousCycle = currentCycle
    ? latestCycles.find((cycle) => cycle.startedAt.getTime() < currentCycle.startedAt.getTime()) ?? null
    : null;

  const [currentTotals, previousTotals] = await Promise.all([
    currentCycle ? getCycleTotals(currentCycle.id) : Promise.resolve([]),
    previousCycle ? getCycleTotals(previousCycle.id) : Promise.resolve([])
  ]);

  const totalWeekSeconds = currentTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0);

  res.json({
    currentCycleId: currentCycle?.id ?? null,
    topCycleId: previousCycle?.id ?? null,
    totalActiveEmployees: activeEmployees,
    totalIncompleteCvs: incompleteCvs,
    totalWeekSeconds,
    totalWeekLabel: secondsToHm(totalWeekSeconds),
    topEmployees: previousTotals.slice(0, 5).map((entry) => ({
      ...entry,
      totalLabel: secondsToHm(entry.totalSeconds)
    }))
  });
});


import { EmployeeStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db/prisma';
import { getTimesheetSummaryMetrics } from '../services/timesheetPerformanceMetrics';
import { getTimesheetSummaryCacheStats } from '../services/timesheetSummaryCache';
import { getCycleTotals } from '../services/timesheetService';
import { secondsToHm } from '../utils/time';

export const dashboardRouter = Router();

const getEmployeePresenceStart = (employee: { cvPostedAt: Date | null; createdAt: Date }): Date =>
  employee.cvPostedAt ?? employee.createdAt;

const isEmployeeEligibleForCycle = (
  employee: { cvPostedAt: Date | null; createdAt: Date; deletedAt: Date | null },
  cycle: { startedAt: Date; endedAt: Date | null }
): boolean => {
  const cycleEnd = cycle.endedAt ?? new Date();
  const joinedAt = getEmployeePresenceStart(employee);

  if (joinedAt.getTime() > cycleEnd.getTime()) {
    return false;
  }

  if (employee.deletedAt && employee.deletedAt.getTime() <= cycle.startedAt.getTime()) {
    return false;
  }

  return true;
};

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
  const currentTotals = currentCycle ? await getCycleTotals(currentCycle.id) : [];

  const totalWeekSeconds = currentTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0);

  res.json({
    currentCycleId: currentCycle?.id ?? null,
    totalActiveEmployees: activeEmployees,
    totalIncompleteCvs: incompleteCvs,
    totalWeekSeconds,
    totalWeekLabel: secondsToHm(totalWeekSeconds),
    timesheetPerformance: {
      ...getTimesheetSummaryMetrics(),
      cacheEntries: getTimesheetSummaryCacheStats().entries
    }
  });
});

dashboardRouter.get('/inactive-report', async (_req, res) => {
  const [completedCycles, activeEmployees] = await Promise.all([
    prisma.weekCycle.findMany({
      where: {
        resetMessageId: {
          not: null
        },
        endedAt: {
          not: null
        }
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.employee.findMany({
      where: {
        status: EmployeeStatus.ACTIVE,
        deletedAt: null
      },
      select: {
        id: true,
        iban: true,
        nickname: true,
        fullName: true,
        rank: true,
        cvPostedAt: true,
        createdAt: true,
        deletedAt: true
      },
      orderBy: [{ nickname: 'asc' }, { fullName: 'asc' }, { id: 'asc' }]
    })
  ]);

  const totalsByCycleAndEmployee = new Map<string, { totalSeconds: number; rank: string | null }>();

  for (const cycle of completedCycles) {
    const totals = await getCycleTotals(cycle.id);

    for (const row of totals) {
      if (row.employeeId == null) {
        continue;
      }

      totalsByCycleAndEmployee.set(`${cycle.id}:${row.employeeId}`, {
        totalSeconds: row.totalSeconds,
        rank: row.rank ?? null
      });
    }
  }

  const zeroMinuteEmployees: Array<{
    employeeId: number;
    employeeCode: string | null;
    displayName: string;
    rank: string | null;
    joinedAt: Date;
    zeroWeeks: Array<{
      cycleId: number;
      startedAt: Date;
      endedAt: Date;
      totalSeconds: number;
      totalLabel: string;
    }>;
  }> = [];
  const underSixtyMinuteEmployees: Array<{
    employeeId: number;
    employeeCode: string | null;
    displayName: string;
    rank: string | null;
    joinedAt: Date;
    lowWeeks: Array<{
      cycleId: number;
      startedAt: Date;
      endedAt: Date;
      totalSeconds: number;
      totalLabel: string;
    }>;
  }> = [];

  for (const employee of activeEmployees) {
    const joinedAt = getEmployeePresenceStart(employee);
    const eligibleCycles = completedCycles.filter((cycle) => isEmployeeEligibleForCycle(employee, cycle));

    if (!eligibleCycles.length) {
      continue;
    }

    const zeroWeeks = eligibleCycles
      .map((cycle) => {
        const total = totalsByCycleAndEmployee.get(`${cycle.id}:${employee.id}`)?.totalSeconds ?? 0;

        if (total > 0 || !cycle.endedAt) {
          return null;
        }

        return {
          cycleId: cycle.id,
          startedAt: cycle.startedAt,
          endedAt: cycle.endedAt,
          totalSeconds: total,
          totalLabel: secondsToHm(total)
        };
      })
      .filter(
        (
          item
        ): item is {
          cycleId: number;
          startedAt: Date;
          endedAt: Date;
          totalSeconds: number;
          totalLabel: string;
        } => item != null
      );

    const lowWeeks = eligibleCycles
      .map((cycle) => {
        const total = totalsByCycleAndEmployee.get(`${cycle.id}:${employee.id}`)?.totalSeconds ?? 0;

        if (total <= 0 || total >= 60 * 60 || !cycle.endedAt) {
          return null;
        }

        return {
          cycleId: cycle.id,
          startedAt: cycle.startedAt,
          endedAt: cycle.endedAt,
          totalSeconds: total,
          totalLabel: secondsToHm(total)
        };
      })
      .filter(
        (
          item
        ): item is {
          cycleId: number;
          startedAt: Date;
          endedAt: Date;
          totalSeconds: number;
          totalLabel: string;
        } => item != null
      );

    const displayName = employee.nickname ?? employee.fullName ?? employee.iban ?? `Employee #${employee.id}`;
    const fallbackRank = employee.rank ?? null;
    const latestZeroRank =
      zeroWeeks
        .map((week) => totalsByCycleAndEmployee.get(`${week.cycleId}:${employee.id}`)?.rank ?? null)
        .find((value) => Boolean(value)) ?? null;
    const latestLowRank =
      lowWeeks
        .map((week) => totalsByCycleAndEmployee.get(`${week.cycleId}:${employee.id}`)?.rank ?? null)
        .find((value) => Boolean(value)) ?? null;
    const resolvedRank = latestZeroRank ?? latestLowRank ?? fallbackRank;

    if (zeroWeeks.length > 0) {
      zeroMinuteEmployees.push({
        employeeId: employee.id,
        employeeCode: employee.iban ?? null,
        displayName,
        rank: resolvedRank,
        joinedAt,
        zeroWeeks
      });
    }

    if (lowWeeks.length > 0) {
      underSixtyMinuteEmployees.push({
        employeeId: employee.id,
        employeeCode: employee.iban ?? null,
        displayName,
        rank: resolvedRank,
        joinedAt,
        lowWeeks
      });
    }
  }

  zeroMinuteEmployees.sort((a, b) => b.zeroWeeks.length - a.zeroWeeks.length || a.displayName.localeCompare(b.displayName, 'ro'));
  underSixtyMinuteEmployees.sort((a, b) => b.lowWeeks.length - a.lowWeeks.length || a.displayName.localeCompare(b.displayName, 'ro'));

  res.json({
    generatedAt: new Date().toISOString(),
    totalEmployeesChecked: activeEmployees.length,
    totalCompletedCycles: completedCycles.length,
    zeroMinuteWeeks: zeroMinuteEmployees.reduce((sum, employee) => sum + employee.zeroWeeks.length, 0),
    underSixtyMinuteWeeks: underSixtyMinuteEmployees.reduce((sum, employee) => sum + employee.lowWeeks.length, 0),
    zeroMinuteEmployees: zeroMinuteEmployees.map((employee) => ({
      employeeId: employee.employeeId,
      employeeCode: employee.employeeCode,
      displayName: employee.displayName,
      rank: employee.rank,
      joinedAt: employee.joinedAt.toISOString(),
      zeroWeeks: employee.zeroWeeks.map((week) => ({
        cycleId: week.cycleId,
        startedAt: week.startedAt.toISOString(),
        endedAt: week.endedAt.toISOString(),
        totalSeconds: week.totalSeconds,
        totalLabel: week.totalLabel
      }))
    })),
    underSixtyMinuteEmployees: underSixtyMinuteEmployees.map((employee) => ({
      employeeId: employee.employeeId,
      employeeCode: employee.employeeCode,
      displayName: employee.displayName,
      rank: employee.rank,
      joinedAt: employee.joinedAt.toISOString(),
      lowWeeks: employee.lowWeeks.map((week) => ({
        cycleId: week.cycleId,
        startedAt: week.startedAt.toISOString(),
        endedAt: week.endedAt.toISOString(),
        totalSeconds: week.totalSeconds,
        totalLabel: week.totalLabel
      }))
    }))
  });
});


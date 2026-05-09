import { TimeEventType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { resolveDiscordAvatarMap } from './discordAvatarService';
import { resolveGuildEmployeeRolePresence } from './guildEmployeePresenceService';
import {
  getTimesheetSummaryFromCache,
  setTimesheetSummaryCache
} from './timesheetSummaryCache';
import { recordTimesheetSummaryMetric } from './timesheetPerformanceMetrics';
import { getCycleTotals, getWeekCycles } from './timesheetService';
import { secondsToHm } from '../utils/time';

export const SUMMARY_CACHE_TTL_OPEN_MS = 20 * 1000;
export const SUMMARY_CACHE_TTL_CLOSED_MS = 24 * 60 * 60 * 1000;

type BuildSummaryOptions = {
  useCache?: boolean;
  includeLivePresenceForOpenCycle?: boolean;
  recordMetrics?: boolean;
};

export const buildTimesheetSummaryPayload = async (
  cycleId: number,
  options?: BuildSummaryOptions
): Promise<Record<string, unknown> | null> => {
  const useCache = options?.useCache ?? true;
  const includeLivePresenceForOpenCycle = options?.includeLivePresenceForOpenCycle ?? true;
  const shouldRecordMetrics = options?.recordMetrics ?? true;
  const startedAtMs = Date.now();

  if (useCache) {
    const cached = getTimesheetSummaryFromCache(cycleId);
    if (cached) {
      if (shouldRecordMetrics) {
        recordTimesheetSummaryMetric({
          cacheHit: true,
          durationMs: Date.now() - startedAtMs
        });
      }
      return cached;
    }
  }

  const cycleMeta = await prisma.weekCycle.findUnique({
    where: { id: cycleId },
    select: { endedAt: true }
  });

  if (!cycleMeta) {
    if (shouldRecordMetrics) {
      recordTimesheetSummaryMetric({
        cacheHit: false,
        durationMs: Date.now() - startedAtMs
      });
    }
    return null;
  }

  const totals = await getCycleTotals(cycleId);
  const rolePresenceByDiscordId =
    cycleMeta.endedAt == null && includeLivePresenceForOpenCycle
      ? await resolveGuildEmployeeRolePresence(
          totals
            .map((row) => row.discordUserId)
            .filter((value): value is string => Boolean(value))
        )
      : {};

  const employeeIds = totals
    .map((row) => row.employeeId)
    .filter((value): value is number => typeof value === 'number');

  const payrollStatuses =
    employeeIds.length > 0
      ? await prisma.timesheetPayrollStatus.findMany({
          where: {
            weekCycleId: cycleId,
            employeeId: {
              in: employeeIds
            }
          }
        })
      : [];

  const payrollByEmployee = new Map(payrollStatuses.map((item) => [item.employeeId, item]));
  const avatarByDiscordUserId = await resolveDiscordAvatarMap(
    totals.map((row) => row.discordUserId).filter((value): value is string => Boolean(value))
  );

  const payload = {
    cycleId,
    totals: totals.map((row) => ({
      ...row,
      isExited:
        cycleMeta.endedAt == null && row.discordUserId
          ? rolePresenceByDiscordId[row.discordUserId] === false
          : row.isExited,
      avatarUrl: row.discordUserId ? avatarByDiscordUserId[row.discordUserId] ?? null : null,
      totalLabel: secondsToHm(row.totalSeconds),
      normalLabel: secondsToHm(row.normalSeconds),
      manualLabel: secondsToHm(row.manualAdjustmentSeconds),
      payroll: row.employeeId
        ? {
            isPaid: payrollByEmployee.get(row.employeeId)?.isPaid ?? false,
            isUp: payrollByEmployee.get(row.employeeId)?.isUp ?? false,
            paidAt: payrollByEmployee.get(row.employeeId)?.paidAt ?? null,
            paidBy: payrollByEmployee.get(row.employeeId)?.paidBy ?? null,
            note: payrollByEmployee.get(row.employeeId)?.note ?? null
          }
        : {
            isPaid: false,
            isUp: false,
            paidAt: null,
            paidBy: null,
            note: null
          }
    }))
  };

  setTimesheetSummaryCache(
    cycleId,
    payload as unknown as Record<string, unknown>,
    cycleMeta.endedAt ? SUMMARY_CACHE_TTL_CLOSED_MS : SUMMARY_CACHE_TTL_OPEN_MS
  );

  if (shouldRecordMetrics) {
    recordTimesheetSummaryMetric({
      cacheHit: false,
      durationMs: Date.now() - startedAtMs
    });
  }

  return payload as unknown as Record<string, unknown>;
};

export const warmTimesheetSummaryCache = async (
  cycleLimit = 4
): Promise<{ warmed: number; skippedOpen: number; failed: number }> => {
  const cycles = await getWeekCycles(undefined, Math.max(1, Math.min(cycleLimit, 12)));

  let warmed = 0;
  let skippedOpen = 0;
  let failed = 0;

  for (const cycle of cycles) {
    if (!cycle.endedAt) {
      skippedOpen += 1;
      continue;
    }

    try {
      await buildTimesheetSummaryPayload(cycle.id, {
        useCache: false,
        includeLivePresenceForOpenCycle: false,
        recordMetrics: false
      });
      warmed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    warmed,
    skippedOpen,
    failed
  };
};

export const resolveLatestCycleId = async (
  cycleIdQuery: string | undefined,
  serviceCodeQuery?: string
): Promise<number | null> => {
  if (cycleIdQuery) {
    const parsed = Number.parseInt(cycleIdQuery, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const cycles = await getWeekCycles(serviceCodeQuery, 4);
  if (cycles.length) {
    return cycles[0].id;
  }

  const latestFallback = await prisma.weekCycle.findFirst({
    where: {
      ...(serviceCodeQuery ? { serviceCode: serviceCodeQuery } : {}),
      timeEvents: {
        some: {
          isDeleted: false,
          eventType: {
            in: [TimeEventType.CLOCK_IN, TimeEventType.CLOCK_OUT, TimeEventType.MANUAL_ADJUSTMENT]
          }
        }
      }
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

  return latestFallback?.id ?? null;
};

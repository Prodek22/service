import { TimeEventType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { resolveDiscordAvatarMap } from './discordAvatarService';
import { resolveGuildEmployeeRolePresence } from './guildEmployeePresenceService';
import {
  getTimesheetSummaryFromCache,
  invalidateTimesheetSummaryCache,
  setTimesheetSummaryCache
} from './timesheetSummaryCache';
import { recordTimesheetSummaryMetric } from './timesheetPerformanceMetrics';
import { getCycleTotals, getWeekCycles } from './timesheetService';
import { secondsToHm } from '../utils/time';

export const SUMMARY_CACHE_TTL_OPEN_MS = 20 * 1000;
export const SUMMARY_CACHE_TTL_CLOSED_MS = 24 * 60 * 60 * 1000;
const SUMMARY_SNAPSHOT_OPEN_STALE_MS = 30 * 1000;

type BuildSummaryOptions = {
  useCache?: boolean;
  includeLivePresenceForOpenCycle?: boolean;
  recordMetrics?: boolean;
};

type SummaryPayload = Record<string, unknown> & {
  cycleId: number | null;
  totals: unknown[];
};

const rebuildsInFlight = new Set<number>();

const withSnapshotMeta = (
  payload: SummaryPayload,
  input: {
    status: 'ready' | 'building' | 'refreshing' | 'failed';
    generatedAt: Date | null;
    isStale: boolean;
    source: 'memory' | 'snapshot' | 'empty';
    error: string | null;
  }
): SummaryPayload => ({
  ...payload,
  snapshot: {
    status: input.status,
    generatedAt: input.generatedAt,
    isStale: input.isStale,
    source: input.source,
    error: input.error
  }
});

const parseSnapshotPayload = (raw: string | null): SummaryPayload | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SummaryPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.totals)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const computeTimesheetSummaryPayload = async (
  cycleId: number,
  includeLivePresenceForOpenCycle: boolean
): Promise<SummaryPayload | null> => {
  const cycleMeta = await prisma.weekCycle.findUnique({
    where: { id: cycleId },
    select: { endedAt: true }
  });

  if (!cycleMeta) {
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

  return {
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
};

export const rebuildTimesheetSummarySnapshot = async (
  cycleId: number,
  input?: { includeLivePresenceForOpenCycle?: boolean }
): Promise<SummaryPayload | null> => {
  const now = new Date();
  const includeLivePresenceForOpenCycle = input?.includeLivePresenceForOpenCycle ?? true;

  await prisma.timesheetSummarySnapshot.upsert({
    where: { weekCycleId: cycleId },
    create: {
      weekCycleId: cycleId,
      status: 'BUILDING',
      requestedAt: now,
      buildStartedAt: now,
      errorText: null
    },
    update: {
      status: 'BUILDING',
      requestedAt: now,
      buildStartedAt: now,
      errorText: null
    }
  });

  try {
    const payload = await computeTimesheetSummaryPayload(cycleId, includeLivePresenceForOpenCycle);
    const finishedAt = new Date();

    if (!payload) {
      await prisma.timesheetSummarySnapshot.update({
        where: { weekCycleId: cycleId },
        data: {
          status: 'FAILED',
          errorText: 'Cycle not found',
          buildFinishedAt: finishedAt
        }
      });
      return null;
    }

    await prisma.timesheetSummarySnapshot.update({
      where: { weekCycleId: cycleId },
      data: {
        status: 'READY',
        payloadJson: JSON.stringify(payload),
        errorText: null,
        generatedAt: finishedAt,
        buildFinishedAt: finishedAt
      }
    });

    const responsePayload = withSnapshotMeta(payload, {
      status: 'ready',
      generatedAt: finishedAt,
      isStale: false,
      source: 'snapshot',
      error: null
    });

    const cycleMeta = await prisma.weekCycle.findUnique({
      where: { id: cycleId },
      select: { endedAt: true }
    });
    setTimesheetSummaryCache(
      cycleId,
      responsePayload as Record<string, unknown>,
      cycleMeta?.endedAt ? SUMMARY_CACHE_TTL_CLOSED_MS : SUMMARY_CACHE_TTL_OPEN_MS
    );

    return responsePayload;
  } catch (error) {
    await prisma.timesheetSummarySnapshot.update({
      where: { weekCycleId: cycleId },
      data: {
        status: 'FAILED',
        errorText: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error',
        buildFinishedAt: new Date()
      }
    });
    return null;
  }
};

export const queueTimesheetSummarySnapshotRebuild = (
  cycleId: number,
  input?: { includeLivePresenceForOpenCycle?: boolean }
): void => {
  if (rebuildsInFlight.has(cycleId)) {
    return;
  }

  rebuildsInFlight.add(cycleId);
  void rebuildTimesheetSummarySnapshot(cycleId, input).finally(() => {
    rebuildsInFlight.delete(cycleId);
  });
};

export const markTimesheetSummarySnapshotStale = async (cycleId: number): Promise<void> => {
  invalidateTimesheetSummaryCache(cycleId);

  await prisma.timesheetSummarySnapshot.upsert({
    where: { weekCycleId: cycleId },
    create: {
      weekCycleId: cycleId,
      status: 'BUILDING',
      requestedAt: new Date()
    },
    update: {
      status: 'BUILDING',
      requestedAt: new Date(),
      errorText: null
    }
  });

  queueTimesheetSummarySnapshotRebuild(cycleId);
};

export const invalidateTimesheetSummarySnapshots = async (cycleId?: number): Promise<void> => {
  invalidateTimesheetSummaryCache(cycleId);

  if (typeof cycleId === 'number') {
    await prisma.timesheetSummarySnapshot.deleteMany({
      where: { weekCycleId: cycleId }
    });
    return;
  }

  await prisma.timesheetSummarySnapshot.deleteMany({});
};

export const buildTimesheetSummaryPayload = async (
  cycleId: number,
  options?: BuildSummaryOptions
): Promise<SummaryPayload | null> => {
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
      return cached as SummaryPayload;
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

  const snapshot = await prisma.timesheetSummarySnapshot.findUnique({
    where: { weekCycleId: cycleId }
  });
  const snapshotPayload = parseSnapshotPayload(snapshot?.payloadJson ?? null);
  const generatedAt = snapshot?.generatedAt ?? null;
  const openSnapshotIsStale =
    cycleMeta.endedAt == null && (!generatedAt || Date.now() - generatedAt.getTime() > SUMMARY_SNAPSHOT_OPEN_STALE_MS);
  const snapshotIsStale = !snapshot || snapshot.status !== 'READY' || openSnapshotIsStale;

  if (snapshotPayload) {
    if (snapshotIsStale) {
      queueTimesheetSummarySnapshotRebuild(cycleId, { includeLivePresenceForOpenCycle });
    }

    const payload = withSnapshotMeta(snapshotPayload, {
      status: snapshotIsStale ? (snapshot?.status === 'FAILED' ? 'failed' : 'refreshing') : 'ready',
      generatedAt,
      isStale: snapshotIsStale,
      source: 'snapshot',
      error: snapshot?.errorText ?? null
    });

    setTimesheetSummaryCache(
      cycleId,
      payload as Record<string, unknown>,
      snapshotIsStale ? 2_000 : cycleMeta.endedAt ? SUMMARY_CACHE_TTL_CLOSED_MS : SUMMARY_CACHE_TTL_OPEN_MS
    );

    if (shouldRecordMetrics) {
      recordTimesheetSummaryMetric({
        cacheHit: true,
        durationMs: Date.now() - startedAtMs
      });
    }

    return payload;
  }

  if (!snapshot || snapshot.status !== 'BUILDING') {
    queueTimesheetSummarySnapshotRebuild(cycleId, { includeLivePresenceForOpenCycle });
  }

  if (shouldRecordMetrics) {
    recordTimesheetSummaryMetric({
      cacheHit: false,
      durationMs: Date.now() - startedAtMs
    });
  }

  return withSnapshotMeta(
    {
      cycleId,
      totals: []
    },
    {
      status: snapshot?.status === 'FAILED' ? 'failed' : 'building',
      generatedAt,
      isStale: true,
      source: 'empty',
      error: snapshot?.errorText ?? null
    }
  );
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
      const result = await rebuildTimesheetSummarySnapshot(cycle.id, {
        includeLivePresenceForOpenCycle: false
      });
      if (result) {
        warmed += 1;
      } else {
        failed += 1;
      }
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

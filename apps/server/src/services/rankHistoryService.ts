import { prisma } from '../db/prisma';
import { normalizeForCompare } from '../utils/normalize';

const normalizeRankValue = (rank: string | null | undefined): string | null => {
  if (typeof rank !== 'string') {
    return null;
  }

  const trimmed = rank.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const ranksEqual = (left: string | null | undefined, right: string | null | undefined): boolean =>
  normalizeForCompare(left ?? '') === normalizeForCompare(right ?? '');

export const recordEmployeeRankSnapshot = async (params: {
  employeeId: number;
  rank: string | null | undefined;
  effectiveFrom: Date;
  source?: string;
  changedBy?: string | null;
}): Promise<void> => {
  const normalizedRank = normalizeRankValue(params.rank);
  if (!normalizedRank) {
    return;
  }

  const latest = await prisma.employeeRankHistory.findFirst({
    where: {
      employeeId: params.employeeId
    },
    orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    select: {
      rank: true,
      effectiveFrom: true
    }
  });

  if (latest && ranksEqual(latest.rank, normalizedRank)) {
    return;
  }

  await prisma.employeeRankHistory.create({
    data: {
      employeeId: params.employeeId,
      rank: normalizedRank,
      effectiveFrom: params.effectiveFrom,
      source: params.source ?? null,
      changedBy: params.changedBy ?? null
    }
  });
};

export const recordEmployeeRankChangeIfDifferent = async (params: {
  employeeId: number;
  previousRank: string | null | undefined;
  nextRank: string | null | undefined;
  effectiveFrom: Date;
  source?: string;
  changedBy?: string | null;
}): Promise<void> => {
  if (ranksEqual(params.previousRank, params.nextRank)) {
    return;
  }

  await recordEmployeeRankSnapshot({
    employeeId: params.employeeId,
    rank: params.nextRank,
    effectiveFrom: params.effectiveFrom,
    source: params.source,
    changedBy: params.changedBy
  });
};

export const getEmployeeRankHistory = async (employeeId: number, limit = 50) =>
  prisma.employeeRankHistory.findMany({
    where: { employeeId },
    orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    take: Math.max(1, Math.min(limit, 200))
  });

type BackfillCandidate = {
  employeeId: number;
  rank: string;
  effectiveFrom: Date;
  source: string;
  changedBy: string;
  sourceOrder: number;
};

const sourcePriority = (source: string): number => {
  if (source === 'backfill_employee_profile') return 0;
  if (source === 'backfill_payroll_snapshot') return 1;
  return 2;
};

export const backfillEmployeeRankHistoryFromExistingData = async (): Promise<{
  scannedEmployees: number;
  insertedRows: number;
  candidates: number;
}> => {
  const [employees, eventRows, payrollRows, existingRows] = await Promise.all([
    prisma.employee.findMany({
      select: {
        id: true,
        rank: true,
        cvPostedAt: true,
        createdAt: true
      }
    }),
    prisma.timeEvent.findMany({
      where: {
        isDeleted: false,
        targetEmployeeId: {
          not: null
        },
        targetEmployeeRank: {
          not: null
        },
        eventType: {
          in: ['CLOCK_IN', 'CLOCK_OUT', 'MANUAL_ADJUSTMENT']
        }
      },
      select: {
        targetEmployeeId: true,
        targetEmployeeRank: true,
        eventAt: true
      },
      orderBy: [{ targetEmployeeId: 'asc' }, { eventAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.timesheetPayrollStatus.findMany({
      where: {
        rankSnapshot: {
          not: null
        }
      },
      select: {
        employeeId: true,
        rankSnapshot: true,
        weekCycle: {
          select: {
            startedAt: true
          }
        }
      },
      orderBy: [{ employeeId: 'asc' }, { weekCycle: { startedAt: 'asc' } }, { id: 'asc' }]
    }),
    prisma.employeeRankHistory.findMany({
      select: {
        employeeId: true,
        rank: true,
        effectiveFrom: true
      }
    })
  ]);

  const existingKeys = new Set(
    existingRows.map((row) => `${row.employeeId}|${normalizeForCompare(row.rank)}|${row.effectiveFrom.getTime()}`)
  );

  const candidatesByEmployee = new Map<number, BackfillCandidate[]>();
  const pushCandidate = (candidate: BackfillCandidate) => {
    const normalized = normalizeRankValue(candidate.rank);
    if (!normalized) {
      return;
    }

    const list = candidatesByEmployee.get(candidate.employeeId) ?? [];
    list.push({
      ...candidate,
      rank: normalized,
      sourceOrder: sourcePriority(candidate.source)
    });
    candidatesByEmployee.set(candidate.employeeId, list);
  };

  for (const employee of employees) {
    const rank = normalizeRankValue(employee.rank);
    if (!rank) {
      continue;
    }

    pushCandidate({
      employeeId: employee.id,
      rank,
      effectiveFrom: employee.cvPostedAt ?? employee.createdAt,
      source: 'backfill_employee_profile',
      changedBy: 'system-backfill',
      sourceOrder: 0
    });
  }

  for (const row of eventRows) {
    if (!row.targetEmployeeId || !row.targetEmployeeRank) {
      continue;
    }

    pushCandidate({
      employeeId: row.targetEmployeeId,
      rank: row.targetEmployeeRank,
      effectiveFrom: row.eventAt,
      source: 'backfill_time_event',
      changedBy: 'system-backfill',
      sourceOrder: 2
    });
  }

  for (const row of payrollRows) {
    if (!row.rankSnapshot) {
      continue;
    }

    pushCandidate({
      employeeId: row.employeeId,
      rank: row.rankSnapshot,
      effectiveFrom: row.weekCycle.startedAt,
      source: 'backfill_payroll_snapshot',
      changedBy: 'system-backfill',
      sourceOrder: 1
    });
  }

  const rowsToInsert: Array<{
    employeeId: number;
    rank: string;
    effectiveFrom: Date;
    source: string;
    changedBy: string;
  }> = [];

  for (const [employeeId, candidates] of candidatesByEmployee.entries()) {
    const ordered = [...candidates].sort((a, b) => {
      const timeDelta = a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return a.sourceOrder - b.sourceOrder;
    });

    let lastRankNormalized: string | null = null;
    for (const candidate of ordered) {
      const normalizedRank = normalizeForCompare(candidate.rank);
      if (!normalizedRank) {
        continue;
      }

      if (normalizedRank === lastRankNormalized) {
        continue;
      }

      const key = `${employeeId}|${normalizedRank}|${candidate.effectiveFrom.getTime()}`;
      if (existingKeys.has(key)) {
        lastRankNormalized = normalizedRank;
        continue;
      }

      rowsToInsert.push({
        employeeId,
        rank: candidate.rank,
        effectiveFrom: candidate.effectiveFrom,
        source: candidate.source,
        changedBy: candidate.changedBy
      });
      existingKeys.add(key);
      lastRankNormalized = normalizedRank;
    }
  }

  if (rowsToInsert.length > 0) {
    await prisma.employeeRankHistory.createMany({
      data: rowsToInsert
    });
  }

  return {
    scannedEmployees: employees.length,
    insertedRows: rowsToInsert.length,
    candidates: [...candidatesByEmployee.values()].reduce((sum, list) => sum + list.length, 0)
  };
};

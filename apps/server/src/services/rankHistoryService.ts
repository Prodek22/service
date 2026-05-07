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

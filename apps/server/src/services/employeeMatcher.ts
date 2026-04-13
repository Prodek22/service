import { Employee } from '@prisma/client';
import { prisma } from '../db/prisma';
import { levenshtein, normalizeForCompare } from '../utils/normalize';

type MatchInput = {
  discordUserId?: string;
  nickname?: string;
  fullName?: string;
  employeeCode?: string;
};

const scoreCandidate = (employee: Employee, input: MatchInput): number => {
  let score = 0;
  const normalizedNickname = normalizeForCompare(input.nickname ?? '');
  const normalizedFullName = normalizeForCompare(input.fullName ?? '');

  if (input.discordUserId && employee.discordUserId === input.discordUserId) {
    score += 100;
  }

  if (normalizedNickname && employee.nickname) {
    const candidate = normalizeForCompare(employee.nickname);
    const distance = levenshtein(normalizedNickname, candidate);
    score += Math.max(0, 20 - distance * 2);
  }

  if (normalizedFullName && employee.fullName) {
    const candidate = normalizeForCompare(employee.fullName);
    const distance = levenshtein(normalizedFullName, candidate);
    score += Math.max(0, 30 - distance * 2);
  }

  return score;
};

export const ensureEmployeeAliases = async (employeeId: number, aliases: string[]): Promise<void> => {
  for (const alias of aliases) {
    if (!alias?.trim()) {
      continue;
    }

    const normalized = normalizeForCompare(alias);
    if (!normalized) {
      continue;
    }

    await prisma.employeeAlias.upsert({
      where: {
        employeeId_normalized: {
          employeeId,
          normalized
        }
      },
      update: {
        aliasValue: alias
      },
      create: {
        employeeId,
        aliasType: 'auto',
        aliasValue: alias,
        normalized
      }
    });
  }
};

export const findEmployeeBestMatch = async (input: MatchInput): Promise<Employee | null> => {
  const normalizedCode = String(input.employeeCode ?? '').trim();
  if (normalizedCode) {
    const byCode = await prisma.employee.findFirst({
      where: {
        iban: normalizedCode,
        deletedAt: null
      }
    });

    if (byCode) {
      return byCode;
    }
  }

  if (input.discordUserId) {
    const byDiscordId = await prisma.employee.findFirst({
      where: {
        discordUserId: input.discordUserId,
        deletedAt: null
      }
    });

    if (byDiscordId) {
      return byDiscordId;
    }
  }

  const aliasCandidates = [input.nickname, input.fullName, input.employeeCode]
    .filter(Boolean)
    .map((value) => normalizeForCompare(value as string))
    .filter(Boolean);

  if (aliasCandidates.length) {
    const aliasMatch = await prisma.employeeAlias.findFirst({
      where: {
        normalized: {
          in: aliasCandidates
        }
      },
      include: {
        employee: true
      }
    });

    if (aliasMatch?.employee && !aliasMatch.employee.deletedAt) {
      return aliasMatch.employee;
    }
  }

  const employees = await prisma.employee.findMany({
    where: {
      deletedAt: null
    },
    take: 500
  });

  let best: Employee | null = null;
  let bestScore = 0;

  for (const employee of employees) {
    const score = scoreCandidate(employee, input);
    if (score > bestScore) {
      best = employee;
      bestScore = score;
    }
  }

  if (bestScore >= 20) {
    return best;
  }

  return null;
};


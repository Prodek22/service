import { TimeEventType, WeekCycle } from '@prisma/client';
import { prisma } from '../db/prisma';
import { parseTimesheetMessage } from '../parsers/timesheetParser';
import { MessageInput } from '../types';
import { normalizeForCompare } from '../utils/normalize';
import { findEmployeeBestMatch } from './employeeMatcher';

type EmployeeTotal = {
  key: string;
  employeeId: number | null;
  employeeCode: string | null;
  rank: string | null;
  monthsInCity: number | null;
  entryDate: Date | null;
  displayName: string;
  discordUserId: string | null;
  totalSeconds: number;
  normalSeconds: number;
  manualAdjustmentSeconds: number;
  positiveAdjustmentSeconds: number;
  negativeAdjustmentSeconds: number;
  manualAdjustmentsCount: number;
  eventsCount: number;
  payableSeconds: number;
  baseSalary: number;
  topBonus: number;
  salaryTotal: number;
  inactiveLast3Weeks: boolean;
};

const PAYROLL_REFERENCE_SECONDS = 7 * 60 * 60;
const PAYROLL_MAX_SECONDS = 21 * 60 * 60;
const TOP_BONUSES = [25000, 20000, 15000] as const;

const RANK_PAY_PER_7H: Record<'ucenic' | 'mecanic_junior' | 'mecanic' | 'mecanic_senior', number> = {
  ucenic: 45000,
  mecanic_junior: 50000,
  mecanic: 55000,
  mecanic_senior: 60000
};

const resolveCanonicalRank = (rank: string | null): keyof typeof RANK_PAY_PER_7H | null => {
  const normalized = normalizeForCompare(rank ?? '');

  if (!normalized) {
    return null;
  }

  if (normalized === 'ucenic') {
    return 'ucenic';
  }

  if (
    normalized === 'mecani junior' ||
    normalized === 'mecani-junior' ||
    normalized === 'mecanic junior' ||
    normalized === 'mecanic-junior'
  ) {
    return 'mecanic_junior';
  }

  if (normalized === 'mecanic') {
    return 'mecanic';
  }

  if (normalized === 'mecanic senior' || normalized === 'mecanic-senior') {
    return 'mecanic_senior';
  }

  return null;
};

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

const extractMentionCodes = (rawText: string): string[] => {
  const matches = [...rawText.matchAll(/@[\p{L}0-9_.-]+(?:\s*-\s*([0-9]{3,}))?/gu)];
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
};

const ensureCurrentCycle = async (serviceCode: string, at: Date): Promise<WeekCycle> => {
  const openCycle = await prisma.weekCycle.findFirst({
    where: {
      serviceCode,
      endedAt: null
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

  if (openCycle) {
    return openCycle;
  }

  return prisma.weekCycle.create({
    data: {
      serviceCode,
      startedAt: at
    }
  });
};

const findCycleForEventAt = async (serviceCode: string, at: Date): Promise<WeekCycle | null> =>
  prisma.weekCycle.findFirst({
    where: {
      serviceCode,
      resetMessageId: {
        not: null
      },
      startedAt: {
        lte: at
      },
      OR: [
        {
          endedAt: null
        },
        {
          endedAt: {
            gt: at
          }
        }
      ]
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

const findLatestResetCycleBeforeAt = async (serviceCode: string, at: Date): Promise<WeekCycle | null> =>
  prisma.weekCycle.findFirst({
    where: {
      serviceCode,
      resetMessageId: {
        not: null
      },
      startedAt: {
        lte: at
      }
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

const findAnyCycleForEventAt = async (serviceCode: string, at: Date): Promise<WeekCycle | null> =>
  prisma.weekCycle.findFirst({
    where: {
      serviceCode,
      startedAt: {
        lte: at
      },
      OR: [
        {
          endedAt: null
        },
        {
          endedAt: {
            gt: at
          }
        }
      ]
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

const findEarliestResetCycleAfterAt = async (serviceCode: string, at: Date): Promise<WeekCycle | null> =>
  prisma.weekCycle.findFirst({
    where: {
      serviceCode,
      resetMessageId: {
        not: null
      },
      startedAt: {
        gt: at
      }
    },
    orderBy: {
      startedAt: 'asc'
    }
  });

const ensureCycleForEventAt = async (serviceCode: string, at: Date): Promise<WeekCycle | null> => {
  const existing = await findCycleForEventAt(serviceCode, at);
  if (existing) {
    return existing;
  }

  const latestResetCycle = await findLatestResetCycleBeforeAt(serviceCode, at);
  if (latestResetCycle) {
    return latestResetCycle;
  }

  const fallbackCycle = await findAnyCycleForEventAt(serviceCode, at);
  if (fallbackCycle) {
    return fallbackCycle;
  }

  const firstResetAfterEvent = await findEarliestResetCycleAfterAt(serviceCode, at);
  if (firstResetAfterEvent) {
    // Event is older than the first known reset cycle; keep it outside weekly cycles.
    return null;
  }

  // No reset cycles exist yet for this service, so we keep using a single open cycle.
  return ensureCurrentCycle(serviceCode, at);
};

const handleResetCycle = async (serviceCode: string, at: Date, messageId: string): Promise<WeekCycle> => {
  return prisma.$transaction(async (tx) => {
    const existingByResetMessage = await tx.weekCycle.findFirst({
      where: {
        serviceCode,
        resetMessageId: messageId
      }
    });

    if (existingByResetMessage) {
      return existingByResetMessage;
    }

    const existingAtSameStart = await tx.weekCycle.findFirst({
      where: {
        serviceCode,
        startedAt: at
      },
      orderBy: {
        id: 'desc'
      }
    });

    if (existingAtSameStart) {
      if (!existingAtSameStart.resetMessageId) {
        return tx.weekCycle.update({
          where: { id: existingAtSameStart.id },
          data: {
            resetMessageId: messageId
          }
        });
      }

      return existingAtSameStart;
    }

    const previousCycle = await tx.weekCycle.findFirst({
      where: {
        serviceCode,
        resetMessageId: {
          not: null
        },
        startedAt: {
          lt: at
        }
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }]
    });

    const nextCycle = await tx.weekCycle.findFirst({
      where: {
        serviceCode,
        resetMessageId: {
          not: null
        },
        startedAt: {
          gt: at
        }
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }]
    });

    if (previousCycle && (!previousCycle.endedAt || previousCycle.endedAt.getTime() > at.getTime())) {
      await tx.weekCycle.update({
        where: { id: previousCycle.id },
        data: {
          endedAt: at
        }
      });
    }

    return tx.weekCycle.create({
      data: {
        serviceCode,
        startedAt: at,
        endedAt: nextCycle?.startedAt ?? null,
        resetMessageId: messageId
      }
    });
  });
};

export const processTimesheetMessage = async (message: MessageInput) => {
  const parsed = parseTimesheetMessage(message.content);
  const serviceCode = parsed.serviceCode ?? 'service';
  const existingEvent = await prisma.timeEvent.findUnique({
    where: {
      discordMessageId: message.id
    },
    select: {
      weekCycleId: true,
      eventType: true,
      serviceCode: true,
      targetEmployeeRank: true
    }
  });

  let weekCycleId: number | null = null;

  if (parsed.eventType === 'WEEKLY_RESET') {
    // Idempotency: if this reset message already exists, do not create a new cycle again.
    if (existingEvent?.eventType === TimeEventType.WEEKLY_RESET && existingEvent.weekCycleId) {
      weekCycleId = existingEvent.weekCycleId;
    } else {
      const resetCycle = await handleResetCycle(serviceCode, message.createdAt, message.id);
      weekCycleId = resetCycle.id;
    }
  } else if (serviceCode) {
    // Always recompute cycle by event timestamp so reprocessing can fix wrong historical assignments.
    const cycle = await ensureCycleForEventAt(serviceCode, message.createdAt);
    weekCycleId = cycle?.id ?? null;
  }

  const employee = await findEmployeeBestMatch({
    discordUserId: parsed.discordUserId,
    nickname: parsed.targetEmployeeName,
    fullName: parsed.targetEmployeeName,
    employeeCode: parsed.targetEmployeeCode
  });

  const resolvedRankSnapshot = existingEvent?.targetEmployeeRank ?? employee?.rank ?? null;

  const event = await prisma.timeEvent.upsert({
    where: {
      discordMessageId: message.id
    },
    update: {
      channelId: message.channelId,
      discordUserId: parsed.discordUserId,
      actorDiscordUserId: parsed.actorDiscordUserId,
      actorName: parsed.actorName,
      targetEmployeeId: employee?.id,
      targetEmployeeName: parsed.targetEmployeeName,
      targetEmployeeRank: resolvedRankSnapshot,
      serviceCode,
      eventType: parsed.eventType as TimeEventType,
      deltaSeconds: parsed.deltaSeconds,
      rawText: message.content,
      eventAt: message.createdAt,
      weekCycleId,
      isDeleted: false
    },
    create: {
      discordMessageId: message.id,
      channelId: message.channelId,
      discordUserId: parsed.discordUserId,
      actorDiscordUserId: parsed.actorDiscordUserId,
      actorName: parsed.actorName,
      targetEmployeeId: employee?.id,
      targetEmployeeName: parsed.targetEmployeeName,
      targetEmployeeRank: resolvedRankSnapshot,
      serviceCode,
      eventType: parsed.eventType as TimeEventType,
      deltaSeconds: parsed.deltaSeconds,
      rawText: message.content,
      eventAt: message.createdAt,
      weekCycleId,
      isDeleted: false
    }
  });

  return event;
};

export const markTimesheetMessageDeleted = async (messageId: string): Promise<void> => {
  await prisma.timeEvent.updateMany({
    where: {
      discordMessageId: messageId
    },
    data: {
      isDeleted: true
    }
  });
};

export const getWeekCycles = async (serviceCode?: string, limit = 6) =>
  prisma.weekCycle.findMany({
    where: {
      ...(serviceCode ? { serviceCode } : {}),
      resetMessageId: {
        not: null
      }
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: Math.max(1, Math.min(limit, 20))
  });

export const getCycleTotals = async (cycleId: number) => {
  const cycle = await prisma.weekCycle.findUnique({
    where: {
      id: cycleId
    }
  });

  if (!cycle) {
    return [];
  }
  const isOpenCycle = cycle.endedAt == null;

  const [events, employees] = await Promise.all([
    prisma.timeEvent.findMany({
      where: {
        weekCycleId: cycleId,
        eventAt: {
          gte: cycle.startedAt,
          ...(cycle.endedAt ? { lt: cycle.endedAt } : {})
        },
        isDeleted: false,
        eventType: {
          in: [TimeEventType.CLOCK_OUT, TimeEventType.MANUAL_ADJUSTMENT, TimeEventType.CLOCK_IN]
        }
      },
      include: {
        employee: true
      },
      orderBy: {
        eventAt: 'asc'
      }
    }),
    prisma.employee.findMany({
      where: {
        OR: [{ deletedAt: null }, { deletedAt: { gt: cycle.startedAt } }]
      },
      select: {
        id: true,
        iban: true,
        rank: true,
        monthsInCity: true,
        nickname: true,
        fullName: true,
        discordUserId: true,
        cvPostedAt: true,
        createdAt: true,
        deletedAt: true
      }
    })
  ]);

  const eligibleEmployees = employees.filter((employee) => isEmployeeEligibleForCycle(employee, cycle));
  const eligibleEmployeeById = new Map(eligibleEmployees.map((employee) => [employee.id, employee]));
  const eligibleEmployeeByDiscordId = new Map<string, number>();
  const eligibleEmployeeByCode = new Map<string, number>();
  const eligibleEmployeeByName = new Map<string, number | null>();

  const putNameIndex = (name: string | null | undefined, employeeId: number) => {
    const normalized = normalizeForCompare(name ?? '');
    if (!normalized) {
      return;
    }

    if (!eligibleEmployeeByName.has(normalized)) {
      eligibleEmployeeByName.set(normalized, employeeId);
      return;
    }

    const existing = eligibleEmployeeByName.get(normalized);
    if (existing !== employeeId) {
      // Ambiguous name, do not auto-resolve by name for this token.
      eligibleEmployeeByName.set(normalized, null);
    }
  };

  for (const employee of eligibleEmployees) {
    if (employee.discordUserId && !eligibleEmployeeByDiscordId.has(employee.discordUserId)) {
      eligibleEmployeeByDiscordId.set(employee.discordUserId, employee.id);
    }

    if (employee.iban) {
      eligibleEmployeeByCode.set(employee.iban.trim(), employee.id);
    }

    putNameIndex(employee.nickname, employee.id);
    putNameIndex(employee.fullName, employee.id);
  }

  const totals = new Map<string, EmployeeTotal>();

  for (const employee of eligibleEmployees) {
    const key = `employee:${employee.id}`;
    totals.set(key, {
      key,
      employeeId: employee.id,
      employeeCode: employee.iban ?? null,
      rank: isOpenCycle ? (employee.rank ?? null) : null,
      monthsInCity: employee.monthsInCity ?? null,
      entryDate: getEmployeePresenceStart(employee),
      displayName: employee.nickname ?? employee.fullName ?? employee.iban ?? `Employee #${employee.id}`,
      discordUserId: employee.discordUserId ?? null,
      totalSeconds: 0,
      normalSeconds: 0,
      manualAdjustmentSeconds: 0,
      positiveAdjustmentSeconds: 0,
      negativeAdjustmentSeconds: 0,
      manualAdjustmentsCount: 0,
      eventsCount: 0,
      payableSeconds: 0,
      baseSalary: 0,
      topBonus: 0,
      salaryTotal: 0,
      inactiveLast3Weeks: false
    });
  }

  const eligibleEmployeeIds = eligibleEmployees.map((employee) => employee.id);

  const cyclePayrollSnapshots =
    eligibleEmployeeIds.length > 0
      ? await prisma.timesheetPayrollStatus.findMany({
          where: {
            weekCycleId: cycleId,
            employeeId: {
              in: eligibleEmployeeIds
            }
          },
          select: {
            employeeId: true,
            monthsSnapshot: true,
            rankSnapshot: true
          }
        })
      : [];
  const cycleMonthsByEmployee = new Map(
    cyclePayrollSnapshots
      .filter((item) => item.monthsSnapshot != null)
      .map((item) => [item.employeeId, item.monthsSnapshot as number])
  );
  const cycleRanksByEmployee = new Map(
    cyclePayrollSnapshots
      .filter((item) => item.rankSnapshot != null && String(item.rankSnapshot).trim().length > 0)
      .map((item) => [item.employeeId, item.rankSnapshot as string])
  );

  if (!isOpenCycle) {
    for (const row of totals.values()) {
      if (!row.employeeId) {
        continue;
      }

      const cycleRank = cycleRanksByEmployee.get(row.employeeId);
      if (cycleRank) {
        row.rank = cycleRank;
      }
    }
  }

  const previousMonthsSnapshots =
    eligibleEmployeeIds.length > 0
      ? await prisma.timesheetPayrollStatus.findMany({
          where: {
            employeeId: {
              in: eligibleEmployeeIds
            },
            monthsSnapshot: {
              not: null
            },
            weekCycle: {
              serviceCode: cycle.serviceCode,
              startedAt: {
                lt: cycle.startedAt
              }
            }
          },
          select: {
            employeeId: true,
            monthsSnapshot: true,
            weekCycle: {
              select: {
                startedAt: true
              }
            }
          }
        })
      : [];

  const previousMonthsByEmployee = new Map<number, { startedAt: number; months: number }>();
  for (const snapshot of previousMonthsSnapshots) {
    if (snapshot.monthsSnapshot == null) {
      continue;
    }

    const startedAt = snapshot.weekCycle.startedAt.getTime();
    const existing = previousMonthsByEmployee.get(snapshot.employeeId);
    if (!existing || startedAt > existing.startedAt) {
      previousMonthsByEmployee.set(snapshot.employeeId, {
        startedAt,
        months: snapshot.monthsSnapshot
      });
    }
  }

  for (const row of totals.values()) {
    if (!row.employeeId) {
      continue;
    }

    const cycleSnapshot = cycleMonthsByEmployee.get(row.employeeId);
    if (typeof cycleSnapshot === 'number') {
      row.monthsInCity = cycleSnapshot;
      continue;
    }

    const previousSnapshot = previousMonthsByEmployee.get(row.employeeId);
    if (previousSnapshot) {
      row.monthsInCity = previousSnapshot.months;
    }
  }

  const resolveEventEmployeeId = (event: (typeof events)[number]): number | null => {
    if (event.targetEmployeeId != null && eligibleEmployeeById.has(event.targetEmployeeId)) {
      return event.targetEmployeeId;
    }

    if (event.discordUserId) {
      const byDiscordId = eligibleEmployeeByDiscordId.get(event.discordUserId);
      if (typeof byDiscordId === 'number') {
        return byDiscordId;
      }
    }

    const mentionCodes = extractMentionCodes(event.rawText);
    if (mentionCodes.length > 0) {
      const preferredCode =
        event.eventType === TimeEventType.MANUAL_ADJUSTMENT
          ? mentionCodes[mentionCodes.length - 1]
          : mentionCodes[0];
      const byCode = eligibleEmployeeByCode.get(preferredCode.trim());
      if (typeof byCode === 'number') {
        return byCode;
      }
    }

    const normalizedTargetName = normalizeForCompare(event.targetEmployeeName ?? '');
    if (normalizedTargetName) {
      const byName = eligibleEmployeeByName.get(normalizedTargetName);
      if (typeof byName === 'number') {
        return byName;
      }
    }

    return null;
  };

  for (const event of events) {
    const resolvedEmployeeId = resolveEventEmployeeId(event);
    if (resolvedEmployeeId == null) {
      continue;
    }

    const key = `employee:${resolvedEmployeeId}`;
    const current = totals.get(key);
    if (!current) {
      continue;
    }

    const delta = event.deltaSeconds ?? 0;
    if (!current.rank) {
      current.rank = event.targetEmployeeRank ?? event.employee?.rank ?? eligibleEmployeeById.get(resolvedEmployeeId)?.rank ?? null;
    }

    if (!current.discordUserId && event.discordUserId) {
      current.discordUserId = event.discordUserId;
    }

    if (event.eventType === TimeEventType.CLOCK_OUT) {
      current.normalSeconds += delta;
      current.totalSeconds += delta;
    }

    if (event.eventType === TimeEventType.MANUAL_ADJUSTMENT) {
      current.manualAdjustmentSeconds += delta;
      current.totalSeconds += delta;
      current.manualAdjustmentsCount += 1;

      if (delta >= 0) {
        current.positiveAdjustmentSeconds += delta;
      } else {
        current.negativeAdjustmentSeconds += delta;
      }
    }

    current.eventsCount += 1;
  }

  for (const row of totals.values()) {
    if (!row.rank) {
      const employee = row.employeeId ? eligibleEmployeeById.get(row.employeeId) : null;
      row.rank = employee?.rank ?? null;
    }
  }

  const rankSnapshotCandidates = [...totals.values()]
    .filter((row) => row.employeeId != null && row.rank)
    .map((row) => ({
      employeeId: row.employeeId as number,
      rank: row.rank as string
    }));

  if (rankSnapshotCandidates.length > 0) {
    await prisma.timesheetPayrollStatus.createMany({
      data: rankSnapshotCandidates.map((item) => ({
        weekCycleId: cycleId,
        employeeId: item.employeeId,
        rankSnapshot: item.rank
      })),
      skipDuplicates: true
    });

    if (isOpenCycle) {
      await Promise.all(
        rankSnapshotCandidates.map((item) =>
          prisma.timesheetPayrollStatus.updateMany({
            where: {
              weekCycleId: cycleId,
              employeeId: item.employeeId
            },
            data: {
              rankSnapshot: item.rank
            }
          })
        )
      );
    } else {
      await Promise.all(
        rankSnapshotCandidates.map((item) =>
          prisma.timesheetPayrollStatus.updateMany({
            where: {
              weekCycleId: cycleId,
              employeeId: item.employeeId,
              rankSnapshot: null
            },
            data: {
              rankSnapshot: item.rank
            }
          })
        )
      );
    }
  }

  const recentCycles = await prisma.weekCycle.findMany({
    where: {
      serviceCode: cycle.serviceCode,
      resetMessageId: {
        not: null
      }
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: 52
  });

  const selectedCycle =
    recentCycles.find((item) => item.id === cycle.id) ?? cycle;
  const isSelectedCurrentCycle = selectedCycle.endedAt === null;
  const completedCyclesDesc = recentCycles.filter((item) => item.endedAt !== null);

  // Window is relative to selected cycle:
  // - current/open cycle => last 3 completed before now
  // - historical completed cycle => selected cycle + previous 2 completed
  const referenceCompletedCycles = isSelectedCurrentCycle
    ? completedCyclesDesc.slice(0, 3)
    : completedCyclesDesc
        .filter(
          (item) =>
            item.startedAt.getTime() < selectedCycle.startedAt.getTime() ||
            (item.startedAt.getTime() === selectedCycle.startedAt.getTime() && item.id <= selectedCycle.id)
        )
        .slice(0, 3);

  const referenceCycleIds = referenceCompletedCycles.map((item) => item.id);
  const groupedPastTotals =
    referenceCycleIds.length > 0
      ? await prisma.timeEvent.groupBy({
          by: ['weekCycleId', 'targetEmployeeId'],
          where: {
            weekCycleId: {
              in: referenceCycleIds
            },
            targetEmployeeId: {
              not: null
            },
            isDeleted: false,
            eventType: {
              in: [TimeEventType.CLOCK_OUT, TimeEventType.MANUAL_ADJUSTMENT]
            }
          },
          _sum: {
            deltaSeconds: true
          }
        })
      : [];

  const totalsByCycleAndEmployee = new Map<string, number>();
  for (const grouped of groupedPastTotals) {
    if (grouped.targetEmployeeId == null) {
      continue;
    }

    totalsByCycleAndEmployee.set(
      `${grouped.weekCycleId}:${grouped.targetEmployeeId}`,
      grouped._sum.deltaSeconds ?? 0
    );
  }

  for (const row of totals.values()) {
    if (!row.employeeId || referenceCompletedCycles.length < 3) {
      row.inactiveLast3Weeks = false;
      continue;
    }

    const employee = eligibleEmployeeById.get(row.employeeId);
    if (!employee) {
      row.inactiveLast3Weeks = false;
      continue;
    }

    const eligibleAllThree = referenceCompletedCycles.every((refCycle) =>
      isEmployeeEligibleForCycle(employee, refCycle)
    );

    if (!eligibleAllThree) {
      row.inactiveLast3Weeks = false;
      continue;
    }

    row.inactiveLast3Weeks = referenceCompletedCycles.every((refCycle) => {
      const total = totalsByCycleAndEmployee.get(`${refCycle.id}:${row.employeeId}`) ?? 0;
      return total <= 0;
    });
  }

  const sorted = [...totals.values()].sort((a, b) => {
    if (b.totalSeconds !== a.totalSeconds) {
      return b.totalSeconds - a.totalSeconds;
    }

    return a.displayName.localeCompare(b.displayName, 'ro');
  });

  for (const row of sorted) {
    const rank = resolveCanonicalRank(row.rank);
    const referenceSalary = rank ? RANK_PAY_PER_7H[rank] : 0;
    row.payableSeconds = Math.min(Math.max(row.totalSeconds, 0), PAYROLL_MAX_SECONDS);
    row.baseSalary = referenceSalary ? Math.round((row.payableSeconds / PAYROLL_REFERENCE_SECONDS) * referenceSalary) : 0;
    row.salaryTotal = row.baseSalary;
  }

  const bonusCandidates = sorted.filter((row) => row.totalSeconds > 0);
  for (let index = 0; index < TOP_BONUSES.length && index < bonusCandidates.length; index += 1) {
    const candidate = bonusCandidates[index];
    candidate.topBonus = TOP_BONUSES[index];
    candidate.salaryTotal = candidate.baseSalary + candidate.topBonus;
  }

  return sorted;
};

export const getEmployeeCycleHistory = async (cycleId: number, employeeId: number) =>
  prisma.$transaction(async (tx) => {
    const cycle = await tx.weekCycle.findUnique({
      where: { id: cycleId },
      select: {
        startedAt: true,
        endedAt: true
      }
    });

    if (!cycle) {
      return [];
    }

    return tx.timeEvent.findMany({
      where: {
        weekCycleId: cycleId,
        targetEmployeeId: employeeId,
        isDeleted: false,
        eventAt: {
          gte: cycle.startedAt,
          ...(cycle.endedAt ? { lt: cycle.endedAt } : {})
        }
      },
      orderBy: {
        eventAt: 'desc'
      }
    });
  });


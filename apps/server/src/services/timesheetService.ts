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
};

const CYCLE_ACTIVITY_EVENT_TYPES: TimeEventType[] = [
  TimeEventType.CLOCK_IN,
  TimeEventType.CLOCK_OUT,
  TimeEventType.MANUAL_ADJUSTMENT
];

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

const ensureCycleForEventAt = async (serviceCode: string, at: Date): Promise<WeekCycle> => {
  const existing = await findCycleForEventAt(serviceCode, at);
  if (existing) {
    return existing;
  }

  return ensureCurrentCycle(serviceCode, at);
};

const handleResetCycle = async (serviceCode: string, at: Date, messageId: string): Promise<WeekCycle> => {
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
    // A real reset message closes the current cycle; this is the weekly boundary source of truth.
    await prisma.weekCycle.update({
      where: { id: openCycle.id },
      data: {
        endedAt: at
      }
    });
  }

  return prisma.weekCycle.create({
    data: {
      serviceCode,
      startedAt: at,
      resetMessageId: messageId
    }
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
      serviceCode: true
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
    weekCycleId = cycle.id;
  }

  const employee = await findEmployeeBestMatch({
    discordUserId: parsed.discordUserId,
    nickname: parsed.targetEmployeeName,
    fullName: parsed.targetEmployeeName
  });

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

export const getWeekCycles = async (serviceCode?: string) => {
  return prisma.weekCycle.findMany({
    where: {
      ...(serviceCode ? { serviceCode } : {}),
      OR: [
        {
          endedAt: null
        },
        {
          timeEvents: {
            some: {
              isDeleted: false,
              eventType: {
                in: CYCLE_ACTIVITY_EVENT_TYPES
              }
            }
          }
        }
      ]
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }]
  });
};

export const getCycleTotals = async (cycleId: number) => {
  const events = await prisma.timeEvent.findMany({
    where: {
      weekCycleId: cycleId,
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
  });

  const totals = new Map<string, EmployeeTotal>();

  for (const event of events) {
    const key =
      event.targetEmployeeId != null
        ? `employee:${event.targetEmployeeId}`
        : event.discordUserId
          ? `discord:${event.discordUserId}`
          : event.targetEmployeeName
            ? `name:${event.targetEmployeeName}`
            : `unknown:${event.id}`;

    if (!totals.has(key)) {
      totals.set(key, {
        key,
        employeeId: event.targetEmployeeId,
        employeeCode: event.employee?.iban ?? null,
        rank: event.employee?.rank ?? null,
        displayName:
          event.employee?.nickname ??
          event.employee?.fullName ??
          event.targetEmployeeName ??
          event.discordUserId ??
          'Necunoscut',
        discordUserId: event.discordUserId,
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
        salaryTotal: 0
      });
    }

    const current = totals.get(key)!;
    const delta = event.deltaSeconds ?? 0;

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

  const sorted = [...totals.values()]
    .filter((row) => row.employeeId != null)
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

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
  prisma.timeEvent.findMany({
    where: {
      weekCycleId: cycleId,
      targetEmployeeId: employeeId,
      isDeleted: false
    },
    orderBy: {
      eventAt: 'desc'
    }
  });


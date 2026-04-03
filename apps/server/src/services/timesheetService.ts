import { TimeEventType, WeekCycle } from '@prisma/client';
import { prisma } from '../db/prisma';
import { parseTimesheetMessage } from '../parsers/timesheetParser';
import { MessageInput } from '../types';
import { findEmployeeBestMatch } from './employeeMatcher';

type EmployeeTotal = {
  key: string;
  employeeId: number | null;
  displayName: string;
  discordUserId: string | null;
  totalSeconds: number;
  normalSeconds: number;
  manualAdjustmentSeconds: number;
  positiveAdjustmentSeconds: number;
  negativeAdjustmentSeconds: number;
  manualAdjustmentsCount: number;
  eventsCount: number;
};

const CYCLE_ACTIVITY_EVENT_TYPES: TimeEventType[] = [
  TimeEventType.CLOCK_IN,
  TimeEventType.CLOCK_OUT,
  TimeEventType.MANUAL_ADJUSTMENT
];

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

  let weekCycleId: number | null = null;

  if (parsed.eventType === 'WEEKLY_RESET') {
    const resetCycle = await handleResetCycle(serviceCode, message.createdAt, message.id);
    weekCycleId = resetCycle.id;
  } else if (serviceCode) {
    const currentCycle = await ensureCurrentCycle(serviceCode, message.createdAt);
    weekCycleId = currentCycle.id;
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

export const getWeekCycles = async (serviceCode?: string) =>
  prisma.weekCycle.findMany({
    where: {
      ...(serviceCode ? { serviceCode } : {}),
      timeEvents: {
        some: {
          isDeleted: false,
          eventType: {
            in: CYCLE_ACTIVITY_EVENT_TYPES
          }
        }
      }
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

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
        displayName:
          event.employee?.fullName ??
          event.employee?.nickname ??
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
        eventsCount: 0
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

  return [...totals.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);
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


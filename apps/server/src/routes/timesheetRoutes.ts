import { Router } from 'express';
import { TimeEventType } from '@prisma/client';
import { requireAdmin } from '../auth/middleware';
import { prisma } from '../db/prisma';
import { normalizeForCompare } from '../utils/normalize';
import { recordAuditLog } from '../services/auditLogService';
import { resolveDiscordAvatarMap } from '../services/discordAvatarService';
import {
  getTimesheetSummaryFromCache,
  invalidateTimesheetSummaryCache,
  setTimesheetSummaryCache
} from '../services/timesheetSummaryCache';
import { buildCsv, secondsToHm } from '../utils/time';
import { getCycleTotals, getEmployeeCycleHistory, getWeekCycles } from '../services/timesheetService';

export const timesheetRouter = Router();
const SUMMARY_CACHE_TTL_OPEN_MS = 20 * 1000;
const SUMMARY_CACHE_TTL_CLOSED_MS = 24 * 60 * 60 * 1000;

timesheetRouter.get('/cycles', async (req, res) => {
  const serviceCode = typeof req.query.serviceCode === 'string' ? req.query.serviceCode : undefined;
  const cycles = await getWeekCycles(serviceCode);
  res.json(cycles);
});

const resolveCycleId = async (cycleIdQuery: string | undefined, serviceCodeQuery?: string): Promise<number | null> => {
  if (cycleIdQuery) {
    const parsed = Number.parseInt(cycleIdQuery, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const cycles = await getWeekCycles(serviceCodeQuery);
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

timesheetRouter.get('/summary', async (req, res) => {
  const cycleId = await resolveCycleId(
    typeof req.query.cycleId === 'string' ? req.query.cycleId : undefined,
    typeof req.query.serviceCode === 'string' ? req.query.serviceCode : undefined
  );

  if (!cycleId) {
    res.json({ cycleId: null, totals: [] });
    return;
  }

  const cached = getTimesheetSummaryFromCache(cycleId);
  if (cached) {
    res.json(cached);
    return;
  }

  const cycleMeta = await prisma.weekCycle.findUnique({
    where: { id: cycleId },
    select: { endedAt: true }
  });

  const totals = await getCycleTotals(cycleId);
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
    cycleMeta?.endedAt ? SUMMARY_CACHE_TTL_CLOSED_MS : SUMMARY_CACHE_TTL_OPEN_MS
  );

  res.json(payload);
});

const parseCodesFromText = (rawText: string): string[] => {
  const matches = [...rawText.matchAll(/@[\p{L}0-9_.-]+(?:\s*-\s*([0-9]{3,}))?/gu)];
  return matches.map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
};

timesheetRouter.get('/active', async (req, res) => {
  const hoursInput = Number.parseInt(String(req.query.hours ?? '24'), 10);
  const hours = Number.isNaN(hoursInput) ? 24 : Math.max(1, Math.min(hoursInput, 48));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const serviceCodeFilter = typeof req.query.serviceCode === 'string' ? req.query.serviceCode.trim() : '';

  const [events, activeEmployees] = await Promise.all([
    prisma.timeEvent.findMany({
      where: {
        isDeleted: false,
        eventType: {
          in: [TimeEventType.CLOCK_IN, TimeEventType.CLOCK_OUT]
        },
        eventAt: {
          gte: since
        },
        ...(serviceCodeFilter ? { serviceCode: serviceCodeFilter } : {})
      },
      include: {
        employee: {
          select: {
            id: true,
            iban: true,
            nickname: true,
            fullName: true,
            rank: true,
            discordUserId: true
          }
        }
      },
      orderBy: [{ eventAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.employee.findMany({
      where: {
        deletedAt: null
      },
      select: {
        id: true,
        iban: true,
        nickname: true,
        fullName: true,
        rank: true,
        discordUserId: true
      }
    })
  ]);

  const employeesById = new Map(activeEmployees.map((employee) => [employee.id, employee]));
  const employeesByDiscordId = new Map<string, (typeof activeEmployees)[number]>();
  const employeesByCode = new Map<string, (typeof activeEmployees)[number]>();
  const employeesByName = new Map<string, (typeof activeEmployees)[number] | null>();

  const putName = (value: string | null | undefined, employee: (typeof activeEmployees)[number]) => {
    const normalized = normalizeForCompare(value ?? '');
    if (!normalized) {
      return;
    }

    if (!employeesByName.has(normalized)) {
      employeesByName.set(normalized, employee);
      return;
    }

    const existing = employeesByName.get(normalized);
    if (existing && existing.id !== employee.id) {
      employeesByName.set(normalized, null);
    }
  };

  for (const employee of activeEmployees) {
    if (employee.discordUserId && !employeesByDiscordId.has(employee.discordUserId)) {
      employeesByDiscordId.set(employee.discordUserId, employee);
    }

    if (employee.iban) {
      employeesByCode.set(employee.iban.trim(), employee);
    }

    putName(employee.nickname, employee);
    putName(employee.fullName, employee);
  }

  const resolveEmployee = (event: (typeof events)[number]) => {
    if (event.targetEmployeeId != null) {
      const byId = employeesById.get(event.targetEmployeeId);
      if (byId) {
        return byId;
      }
    }

    if (event.employee?.id != null) {
      const byInclude = employeesById.get(event.employee.id);
      if (byInclude) {
        return byInclude;
      }
    }

    if (event.discordUserId) {
      const byDiscord = employeesByDiscordId.get(event.discordUserId);
      if (byDiscord) {
        return byDiscord;
      }
    }

    const code = parseCodesFromText(event.rawText)[0];
    if (code) {
      const byCode = employeesByCode.get(code);
      if (byCode) {
        return byCode;
      }
    }

    const normalizedTarget = normalizeForCompare(event.targetEmployeeName ?? '');
    if (normalizedTarget) {
      const byName = employeesByName.get(normalizedTarget);
      if (byName) {
        return byName;
      }
    }

    return null;
  };

  const latestByKey = new Map<string, { event: (typeof events)[number]; employee: (typeof activeEmployees)[number] | null }>();
  for (const event of events) {
    const serviceCode = event.serviceCode ?? 'service';
    const resolvedEmployee = resolveEmployee(event);

    let key: string | null = null;
    if (resolvedEmployee) {
      key = `employee:${resolvedEmployee.id}:${serviceCode}`;
    } else if (event.discordUserId) {
      key = `discord:${event.discordUserId}:${serviceCode}`;
    } else if (event.targetEmployeeName) {
      key = `name:${normalizeForCompare(event.targetEmployeeName)}:${serviceCode}`;
    }

    if (!key) {
      continue;
    }

    latestByKey.set(key, { event, employee: resolvedEmployee });
  }

  const now = Date.now();
  const items = [...latestByKey.values()]
    .filter((entry) => entry.event.eventType === TimeEventType.CLOCK_IN)
    .map((entry) => {
      const event = entry.event;
      const employee = entry.employee;
      const displayName =
        employee?.nickname ??
        employee?.fullName ??
        event.employee?.nickname ??
        event.employee?.fullName ??
        event.targetEmployeeName ??
        (event.discordUserId ? `@${event.discordUserId}` : 'Necunoscut');
      const discordUserId = event.discordUserId ?? employee?.discordUserId ?? event.employee?.discordUserId ?? null;

      return {
        key: event.discordMessageId,
        employeeId: employee?.id ?? event.targetEmployeeId ?? event.employee?.id ?? null,
        employeeCode: employee?.iban ?? event.employee?.iban ?? null,
        displayName,
        rank: event.targetEmployeeRank ?? employee?.rank ?? event.employee?.rank ?? null,
        discordUserId,
        serviceCode: event.serviceCode ?? 'service',
        startedAt: event.eventAt.toISOString(),
        elapsedSeconds: Math.max(0, Math.floor((now - event.eventAt.getTime()) / 1000)),
        rawText: event.rawText
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const avatarByDiscordUserId = await resolveDiscordAvatarMap(
    items.map((item) => item.discordUserId).filter((value): value is string => Boolean(value))
  );

  res.json({
    hoursWindow: hours,
    since: since.toISOString(),
    items: items.map((item) => ({
      ...item,
      avatarUrl: item.discordUserId ? avatarByDiscordUserId[item.discordUserId] ?? null : null
    }))
  });
});
timesheetRouter.post('/payroll-status', requireAdmin, async (req, res) => {
  const cycleId = Number.parseInt(String(req.body?.cycleId ?? ''), 10);
  const employeeId = Number.parseInt(String(req.body?.employeeId ?? ''), 10);
  const isPaid = Boolean(req.body?.isPaid);
  const noteInput = typeof req.body?.note === 'string' ? req.body.note.trim() : null;
  const note = noteInput ? noteInput.slice(0, 1000) : null;
  const username = String(res.locals.authUser?.username ?? 'system');

  if (Number.isNaN(cycleId) || Number.isNaN(employeeId)) {
    res.status(400).json({ error: 'cycleId si employeeId sunt obligatorii.' });
    return;
  }

  const totals = await getCycleTotals(cycleId);
  const employeeRow = totals.find((row) => row.employeeId === employeeId);

  if (!employeeRow) {
    res.status(404).json({ error: 'Angajatul nu are pontaj in ciclul selectat.' });
    return;
  }

  const saved = await prisma.timesheetPayrollStatus.upsert({
    where: {
      weekCycleId_employeeId: {
        weekCycleId: cycleId,
        employeeId
      }
    },
    create: {
      weekCycleId: cycleId,
      employeeId,
      salaryTotal: employeeRow.salaryTotal,
      isPaid,
      rankSnapshot: employeeRow.rank ?? null,
      monthsSnapshot: employeeRow.monthsInCity ?? null,
      paidAt: isPaid ? new Date() : null,
      paidBy: isPaid ? username : null,
      note
    },
    update: {
      salaryTotal: employeeRow.salaryTotal,
      isPaid,
      paidAt: isPaid ? new Date() : null,
      paidBy: isPaid ? username : null,
      note
    }
  });

  await recordAuditLog({
    req,
    res,
    action: 'PAYROLL_STATUS_UPDATED',
    entityType: 'timesheet_payroll_status',
    entityId: `${cycleId}:${employeeId}`,
    metadata: {
      cycleId,
      employeeId,
      employeeName: employeeRow.displayName,
      isPaid,
      salaryTotal: employeeRow.salaryTotal,
      paidAt: saved.paidAt?.toISOString() ?? null,
      paidBy: saved.paidBy ?? null
    }
  });

  res.json({
    ok: true,
    payroll: {
      isPaid: saved.isPaid,
      isUp: saved.isUp,
      paidAt: saved.paidAt,
      paidBy: saved.paidBy,
      note: saved.note
    }
  });

  invalidateTimesheetSummaryCache(cycleId);
});

timesheetRouter.post('/up-status', requireAdmin, async (req, res) => {
  const cycleId = Number.parseInt(String(req.body?.cycleId ?? ''), 10);
  const employeeId = Number.parseInt(String(req.body?.employeeId ?? ''), 10);
  const isUp = Boolean(req.body?.isUp);

  if (Number.isNaN(cycleId) || Number.isNaN(employeeId)) {
    res.status(400).json({ error: 'cycleId si employeeId sunt obligatorii.' });
    return;
  }

  const totals = await getCycleTotals(cycleId);
  const employeeRow = totals.find((row) => row.employeeId === employeeId);

  if (!employeeRow) {
    res.status(404).json({ error: 'Angajatul nu are pontaj in ciclul selectat.' });
    return;
  }

  const saved = await prisma.timesheetPayrollStatus.upsert({
    where: {
      weekCycleId_employeeId: {
        weekCycleId: cycleId,
        employeeId
      }
    },
    create: {
      weekCycleId: cycleId,
      employeeId,
      salaryTotal: employeeRow.salaryTotal,
      isPaid: false,
      isUp,
      rankSnapshot: employeeRow.rank ?? null,
      monthsSnapshot: employeeRow.monthsInCity ?? null
    },
    update: {
      salaryTotal: employeeRow.salaryTotal,
      isUp
    }
  });

  await recordAuditLog({
    req,
    res,
    action: 'UP_STATUS_UPDATED',
    entityType: 'timesheet_payroll_status',
    entityId: `${cycleId}:${employeeId}`,
    metadata: {
      cycleId,
      employeeId,
      employeeName: employeeRow.displayName,
      isUp
    }
  });

  res.json({
    ok: true,
    payroll: {
      isPaid: saved.isPaid,
      isUp: saved.isUp,
      paidAt: saved.paidAt,
      paidBy: saved.paidBy,
      note: saved.note
    }
  });

  invalidateTimesheetSummaryCache(cycleId);
});

timesheetRouter.post('/months-status', requireAdmin, async (req, res) => {
  const cycleId = Number.parseInt(String(req.body?.cycleId ?? ''), 10);
  const employeeId = Number.parseInt(String(req.body?.employeeId ?? ''), 10);
  const monthsInCity = Number.parseInt(String(req.body?.monthsInCity ?? ''), 10);

  if (Number.isNaN(cycleId) || Number.isNaN(employeeId) || Number.isNaN(monthsInCity)) {
    res.status(400).json({ error: 'cycleId, employeeId si monthsInCity sunt obligatorii.' });
    return;
  }

  if (monthsInCity < 0 || monthsInCity > 10000) {
    res.status(400).json({ error: 'monthsInCity trebuie sa fie intre 0 si 10000.' });
    return;
  }

  const totals = await getCycleTotals(cycleId);
  const employeeRow = totals.find((row) => row.employeeId === employeeId);

  if (!employeeRow) {
    res.status(404).json({ error: 'Angajatul nu are pontaj in ciclul selectat.' });
    return;
  }

  const saved = await prisma.timesheetPayrollStatus.upsert({
    where: {
      weekCycleId_employeeId: {
        weekCycleId: cycleId,
        employeeId
      }
    },
    create: {
      weekCycleId: cycleId,
      employeeId,
      salaryTotal: employeeRow.salaryTotal,
      isPaid: false,
      isUp: false,
      rankSnapshot: employeeRow.rank ?? null,
      monthsSnapshot: monthsInCity
    },
    update: {
      salaryTotal: employeeRow.salaryTotal,
      monthsSnapshot: monthsInCity
    }
  });

  await recordAuditLog({
    req,
    res,
    action: 'MONTHS_SNAPSHOT_UPDATED',
    entityType: 'timesheet_payroll_status',
    entityId: `${cycleId}:${employeeId}`,
    metadata: {
      cycleId,
      employeeId,
      employeeName: employeeRow.displayName,
      monthsInCity
    }
  });

  res.json({
    ok: true,
    payroll: {
      isPaid: saved.isPaid,
      isUp: saved.isUp,
      monthsInCity: saved.monthsSnapshot ?? monthsInCity,
      paidAt: saved.paidAt,
      paidBy: saved.paidBy,
      note: saved.note
    }
  });

  invalidateTimesheetSummaryCache(cycleId);
});

timesheetRouter.get('/employee/:employeeId/history', async (req, res) => {
  const employeeId = Number.parseInt(req.params.employeeId, 10);

  if (Number.isNaN(employeeId)) {
    res.status(400).json({ error: 'employeeId invalid' });
    return;
  }

  const cycleId = await resolveCycleId(typeof req.query.cycleId === 'string' ? req.query.cycleId : undefined);

  if (!cycleId) {
    res.status(404).json({ error: 'Nu exista ciclu pentru istoric.' });
    return;
  }

  const history = await getEmployeeCycleHistory(cycleId, employeeId);

  res.json({ cycleId, history });
});

timesheetRouter.get('/export.csv', async (req, res) => {
  const cycleId = await resolveCycleId(typeof req.query.cycleId === 'string' ? req.query.cycleId : undefined);

  if (!cycleId) {
    res.status(404).json({ error: 'Nu exista ciclu pentru export.' });
    return;
  }

  const totals = await getCycleTotals(cycleId);

  const rows = [
    [
      'Employee',
      'Employee ID',
      'Rank',
      'Months In City',
      'Entry Date',
      'Discord User ID',
      'Total Seconds',
      'Total (h/m)',
      'Payable Seconds (cap 21h)',
      'Normal Seconds',
      'Manual Adjustment Seconds',
      'Positive Adjustments',
      'Negative Adjustments',
      'Manual Adjustments Count',
      'Base Salary',
      'Top Bonus',
      'Salary Total'
    ],
    ...totals.map((item) => [
      item.displayName,
      item.employeeCode ?? '',
      item.rank ?? '',
      String(item.monthsInCity ?? ''),
      item.entryDate?.toISOString() ?? '',
      item.discordUserId ?? '',
      String(item.totalSeconds),
      secondsToHm(item.totalSeconds),
      String(item.payableSeconds),
      String(item.normalSeconds),
      String(item.manualAdjustmentSeconds),
      String(item.positiveAdjustmentSeconds),
      String(item.negativeAdjustmentSeconds),
      String(item.manualAdjustmentsCount),
      String(item.baseSalary),
      String(item.topBonus),
      String(item.salaryTotal)
    ])
  ];

  const csv = buildCsv(rows);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="timesheet-cycle-${cycleId}.csv"`);
  res.send(csv);
});



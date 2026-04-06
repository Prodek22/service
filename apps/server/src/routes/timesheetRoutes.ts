import { Router } from 'express';
import { TimeEventType } from '@prisma/client';
import { requireAdmin } from '../auth/middleware';
import { prisma } from '../db/prisma';
import { recordAuditLog } from '../services/auditLogService';
import { resolveDiscordAvatarMap } from '../services/discordAvatarService';
import { buildCsv, secondsToHm } from '../utils/time';
import { getCycleTotals, getEmployeeCycleHistory, getWeekCycles } from '../services/timesheetService';

export const timesheetRouter = Router();

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

  res.json({
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
      isUp
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


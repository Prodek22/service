import { Router } from 'express';
import { TimeEventType } from '@prisma/client';
import { prisma } from '../db/prisma';
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

  res.json({
    cycleId,
    totals: totals.map((row) => ({
      ...row,
      totalLabel: secondsToHm(row.totalSeconds),
      normalLabel: secondsToHm(row.normalSeconds),
      manualLabel: secondsToHm(row.manualAdjustmentSeconds)
    }))
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


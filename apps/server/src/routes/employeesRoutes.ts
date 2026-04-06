import { EmployeeStatus } from '@prisma/client';
import { Router } from 'express';
import { requireAdmin } from '../auth/middleware';
import { prisma } from '../db/prisma';
import { recordAuditLog } from '../services/auditLogService';
import { normalizeForCompare } from '../utils/normalize';

const toBoolean = (value: unknown): boolean => String(value).toLowerCase() === 'true';

const allowedSort: Record<string, string> = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  iban: 'iban',
  months: 'monthsInCity',
  nickname: 'nickname',
  full_name: 'fullName',
  rank: 'rank'
};

export const employeesRouter = Router();

type RankTab = 'all' | 'mecanic_senior' | 'mecanic' | 'mecani_junior' | 'ucenic' | 'unknown';

const resolveRankTab = (value: string): RankTab => {
  const normalized = normalizeForCompare(value);

  if (normalized === 'mecanic senior' || normalized === 'mecanic_senior') {
    return 'mecanic_senior';
  }

  if (normalized === 'mecanic') {
    return 'mecanic';
  }

  if (normalized === 'mecani junior' || normalized === 'mecanic junior' || normalized === 'mecani_junior') {
    return 'mecani_junior';
  }

  if (normalized === 'ucenic') {
    return 'ucenic';
  }

  if (normalized === 'unknown') {
    return 'unknown';
  }

  return 'all';
};

const rankSortValue = (rank?: string | null): number => {
  const normalized = normalizeForCompare(rank ?? '');

  if (normalized === 'mecanic senior' || normalized === 'mecanic-senior') {
    return 4;
  }

  if (normalized === 'mecanic') {
    return 3;
  }

  if (
    normalized === 'mecani junior' ||
    normalized === 'mecani-junior' ||
    normalized === 'mecanic junior' ||
    normalized === 'mecanic-junior'
  ) {
    return 2;
  }

  if (normalized === 'ucenic') {
    return 1;
  }

  return 0;
};

const getEntrySortTimestamp = (employee: {
  cvPostedAt: Date | null;
  createdAt: Date;
}): number => (employee.cvPostedAt ?? employee.createdAt).getTime();

const rankMatchesTab = (rank: string | null, rankTab: RankTab): boolean => {
  if (rankTab === 'all') {
    return true;
  }

  const normalized = normalizeForCompare(rank ?? '');

  if (!normalized) {
    return rankTab === 'unknown';
  }

  if (normalized === 'mecanic senior' || normalized === 'mecanic-senior') {
    return rankTab === 'mecanic_senior';
  }

  if (
    normalized === 'mecani junior' ||
    normalized === 'mecani-junior' ||
    normalized === 'mecanic junior' ||
    normalized === 'mecanic-junior'
  ) {
    return rankTab === 'mecani_junior';
  }

  if (normalized === 'mecanic') {
    return rankTab === 'mecanic';
  }

  if (normalized === 'ucenic') {
    return rankTab === 'ucenic';
  }

  return rankTab === 'unknown';
};

employeesRouter.get('/', async (req, res) => {
  const page = Number.parseInt(String(req.query.page ?? '1'), 10);
  const pageSize = Number.parseInt(String(req.query.pageSize ?? '20'), 10);
  const search = String(req.query.search ?? '').trim();
  const status = String(req.query.status ?? '').trim();
  const missingImage = toBoolean(req.query.missingImage);
  const incompleteOnly = toBoolean(req.query.incompleteOnly);
  const rankTab = resolveRankTab(String(req.query.rankTab ?? 'all'));

  const sortByInput = String(req.query.sortBy ?? 'created_at');
  const sortBy = allowedSort[sortByInput] ?? 'createdAt';
  const sortDir = String(req.query.sortDir ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const where = {
    ...(status ? { status: status as EmployeeStatus } : {}),
    ...(search
      ? {
          OR: [
            { iban: { contains: search } },
            { fullName: { contains: search } },
            { nickname: { contains: search } },
            { phone: { contains: search } },
            { employerName: { contains: search } },
            { rank: { contains: search } }
          ]
        }
      : {}),
    ...(missingImage ? { idImageUrl: null } : {}),
    ...(incompleteOnly ? { status: EmployeeStatus.INCOMPLETE } : {})
  };

  const offset = (Math.max(page, 1) - 1) * Math.max(pageSize, 1);
  const limit = Math.max(pageSize, 1);

  const [items, total] =
    sortByInput === 'rank' || sortByInput === 'created_at' || rankTab !== 'all'
      ? await (async () => {
          const allItems = await prisma.employee.findMany({ where });
          const rankFiltered = allItems.filter((item) => rankMatchesTab(item.rank, rankTab));
          const sorted = [...rankFiltered].sort((a, b) => {
            if (sortByInput === 'rank') {
              const delta = rankSortValue(a.rank) - rankSortValue(b.rank);
              if (delta !== 0) {
                return sortDir === 'asc' ? delta : -delta;
              }
            }

            const fallback = getEntrySortTimestamp(a) - getEntrySortTimestamp(b);
            return sortDir === 'asc' ? fallback : -fallback;
          });

          return [sorted.slice(offset, offset + limit), rankFiltered.length] as const;
        })()
      : await Promise.all([
          prisma.employee.findMany({
            where,
            skip: offset,
            take: limit,
            orderBy: {
              [sortBy]: sortDir
            }
          }),
          prisma.employee.count({ where })
        ]);

  res.json({
    items: items.map((item) => ({
      ...item,
      isIncomplete: item.status === EmployeeStatus.INCOMPLETE,
      missingIdImage: !item.idImageUrl
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / Math.max(pageSize, 1))
    }
  });
});

employeesRouter.get('/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'ID invalid' });
    return;
  }

  const employee = await prisma.employee.findUnique({
    where: { id }
  });

  if (!employee) {
    res.status(404).json({ error: 'Angajat inexistent' });
    return;
  }

  res.json(employee);
});

employeesRouter.get('/:id/raw', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'ID invalid' });
    return;
  }

  const entries = await prisma.employeeCvRaw.findMany({
    where: { employeeId: id },
    orderBy: { createdAt: 'desc' }
  });

  res.json(entries);
});

employeesRouter.patch('/:id', requireAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'ID invalid' });
    return;
  }

  const payload = req.body as Record<string, unknown>;
  const existing = await prisma.employee.findUnique({
    where: { id }
  });

  if (!existing) {
    res.status(404).json({ error: 'Angajat inexistent' });
    return;
  }

  const employee = await prisma.employee.update({
    where: { id },
    data: {
      iban: typeof payload.iban === 'string' ? payload.iban : undefined,
      monthsInCity: typeof payload.monthsInCity === 'number' ? payload.monthsInCity : undefined,
      nickname: typeof payload.nickname === 'string' ? payload.nickname : undefined,
      fullName: typeof payload.fullName === 'string' ? payload.fullName : undefined,
      phone: typeof payload.phone === 'string' ? payload.phone : undefined,
      plateNumber: typeof payload.plateNumber === 'string' ? payload.plateNumber : undefined,
      employerName: typeof payload.employerName === 'string' ? payload.employerName : undefined,
      recommendation: typeof payload.recommendation === 'string' ? payload.recommendation : undefined,
      rank: typeof payload.rank === 'string' ? payload.rank : undefined,
      idImageUrl: typeof payload.idImageUrl === 'string' ? payload.idImageUrl : undefined,
      status: typeof payload.status === 'string' ? (payload.status as EmployeeStatus) : undefined
    }
  });

  await recordAuditLog({
    req,
    res,
    action: 'EMPLOYEE_UPDATED',
    entityType: 'employee',
    entityId: id,
    metadata: {
      before: {
        iban: existing.iban,
        monthsInCity: existing.monthsInCity,
        nickname: existing.nickname,
        fullName: existing.fullName,
        phone: existing.phone,
        rank: existing.rank,
        status: existing.status
      },
      after: {
        iban: employee.iban,
        monthsInCity: employee.monthsInCity,
        nickname: employee.nickname,
        fullName: employee.fullName,
        phone: employee.phone,
        rank: employee.rank,
        status: employee.status
      }
    }
  });

  res.json(employee);
});

employeesRouter.get('/:id/aliases', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'ID invalid' });
    return;
  }

  const aliases = await prisma.employeeAlias.findMany({
    where: { employeeId: id },
    orderBy: { createdAt: 'desc' }
  });

  res.json(aliases);
});

employeesRouter.post('/:id/aliases', requireAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'ID invalid' });
    return;
  }

  const aliasValue = String(req.body?.aliasValue ?? '').trim();
  const aliasType = String(req.body?.aliasType ?? 'manual').trim();

  if (!aliasValue) {
    res.status(400).json({ error: 'aliasValue este obligatoriu' });
    return;
  }

  const normalized = normalizeForCompare(aliasValue);

  const alias = await prisma.employeeAlias.upsert({
    where: {
      employeeId_normalized: {
        employeeId: id,
        normalized
      }
    },
    update: {
      aliasType,
      aliasValue
    },
    create: {
      employeeId: id,
      aliasType,
      aliasValue,
      normalized
    }
  });

  await recordAuditLog({
    req,
    res,
    action: 'EMPLOYEE_ALIAS_UPSERTED',
    entityType: 'employee',
    entityId: id,
    metadata: {
      aliasId: alias.id,
      aliasType: alias.aliasType,
      aliasValue: alias.aliasValue,
      normalized: alias.normalized
    }
  });

  res.status(201).json(alias);
});


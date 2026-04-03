import { EmployeeStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db/prisma';
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

employeesRouter.get('/', async (req, res) => {
  const page = Number.parseInt(String(req.query.page ?? '1'), 10);
  const pageSize = Number.parseInt(String(req.query.pageSize ?? '20'), 10);
  const search = String(req.query.search ?? '').trim();
  const status = String(req.query.status ?? '').trim();
  const missingImage = toBoolean(req.query.missingImage);
  const incompleteOnly = toBoolean(req.query.incompleteOnly);

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
    sortByInput === 'rank'
      ? await (async () => {
          const allItems = await prisma.employee.findMany({ where });
          const sorted = [...allItems].sort((a, b) => {
            const delta = rankSortValue(a.rank) - rankSortValue(b.rank);

            if (delta !== 0) {
              return sortDir === 'asc' ? delta : -delta;
            }

            const fallback = a.createdAt.getTime() - b.createdAt.getTime();
            return sortDir === 'asc' ? fallback : -fallback;
          });

          return [sorted.slice(offset, offset + limit), allItems.length] as const;
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

employeesRouter.patch('/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'ID invalid' });
    return;
  }

  const payload = req.body as Record<string, unknown>;

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

employeesRouter.post('/:id/aliases', async (req, res) => {
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

  res.status(201).json(alias);
});


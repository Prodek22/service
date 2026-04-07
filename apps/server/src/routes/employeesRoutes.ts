import { EmployeeStatus } from '@prisma/client';
import { constants as fsConstants, promises as fs } from 'fs';
import { Router } from 'express';
import { requireAdmin } from '../auth/middleware';
import { prisma } from '../db/prisma';
import { recordAuditLog } from '../services/auditLogService';
import { deleteLocalIdImage, isLocalIdImageUrl, resolveLocalIdImageAbsolutePath } from '../services/idImageStorage';
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

type ImageCheckResult = {
  employeeId: number;
  employeeCode: string | null;
  nickname: string | null;
  fullName: string | null;
  url: string;
  ok: boolean;
  reason: string;
};

const DISCORD_UNAVAILABLE_PATTERN = /this content is no longer available/i;

const checkImageUrl = async (
  employee: { id: number; iban: string | null; nickname: string | null; fullName: string | null; idImageUrl: string }
): Promise<ImageCheckResult> => {
  const url = employee.idImageUrl;
  if (isLocalIdImageUrl(url)) {
    const absolutePath = resolveLocalIdImageAbsolutePath(url);

    if (!absolutePath) {
      return {
        employeeId: employee.id,
        employeeCode: employee.iban,
        nickname: employee.nickname,
        fullName: employee.fullName,
        url,
        ok: false,
        reason: 'Invalid local image path'
      };
    }

    try {
      await fs.access(absolutePath, fsConstants.F_OK);
      return {
        employeeId: employee.id,
        employeeCode: employee.iban,
        nickname: employee.nickname,
        fullName: employee.fullName,
        url,
        ok: true,
        reason: 'ok'
      };
    } catch {
      return {
        employeeId: employee.id,
        employeeCode: employee.iban,
        nickname: employee.nickname,
        fullName: employee.fullName,
        url,
        ok: false,
        reason: 'Local file missing'
      };
    }
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: {
        Range: 'bytes=0-4096'
      }
    });

    if (!response.ok) {
      return {
        employeeId: employee.id,
        employeeCode: employee.iban,
        nickname: employee.nickname,
        fullName: employee.fullName,
        url,
        ok: false,
        reason: `HTTP ${response.status}`
      };
    }

    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();

    if (contentType.startsWith('image/')) {
      return {
        employeeId: employee.id,
        employeeCode: employee.iban,
        nickname: employee.nickname,
        fullName: employee.fullName,
        url,
        ok: true,
        reason: 'ok'
      };
    }

    const text = await response.text();
    if (DISCORD_UNAVAILABLE_PATTERN.test(text)) {
      return {
        employeeId: employee.id,
        employeeCode: employee.iban,
        nickname: employee.nickname,
        fullName: employee.fullName,
        url,
        ok: false,
        reason: 'Discord attachment unavailable'
      };
    }

    return {
      employeeId: employee.id,
      employeeCode: employee.iban,
      nickname: employee.nickname,
      fullName: employee.fullName,
      url,
      ok: false,
      reason: contentType ? `Unexpected content-type: ${contentType}` : 'Unexpected non-image response'
    };
  } catch (error) {
    return {
      employeeId: employee.id,
      employeeCode: employee.iban,
      nickname: employee.nickname,
      fullName: employee.fullName,
      url,
      ok: false,
      reason: error instanceof Error ? error.message : 'Network error'
    };
  }
};

const mapLimit = async <T, R>(
  input: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const safeConcurrency = Math.max(1, Math.min(concurrency, 20));
  const results: R[] = new Array(input.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < input.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(input[currentIndex]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(safeConcurrency, input.length) }, () => worker()));
  return results;
};

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
    ...(status ? { status: status as EmployeeStatus } : { status: { not: EmployeeStatus.DELETED } }),
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

employeesRouter.post('/verify-id-images', requireAdmin, async (req, res) => {
  const limitInput = Number.parseInt(String(req.body?.limit ?? '300'), 10);
  const concurrencyInput = Number.parseInt(String(req.body?.concurrency ?? '8'), 10);
  const limit = Number.isNaN(limitInput) ? 300 : Math.max(1, Math.min(limitInput, 2000));
  const concurrency = Number.isNaN(concurrencyInput) ? 8 : Math.max(1, Math.min(concurrencyInput, 20));

  const employees = await prisma.employee.findMany({
    where: {
      status: {
        not: EmployeeStatus.DELETED
      },
      idImageUrl: {
        not: null
      }
    },
    select: {
      id: true,
      iban: true,
      nickname: true,
      fullName: true,
      idImageUrl: true
    },
    orderBy: {
      updatedAt: 'desc'
    },
    take: limit
  });

  const results = await mapLimit(employees, concurrency, (employee) =>
    checkImageUrl({
      id: employee.id,
      iban: employee.iban,
      nickname: employee.nickname,
      fullName: employee.fullName,
      idImageUrl: String(employee.idImageUrl)
    })
  );

  const invalid = results.filter((item) => !item.ok);
  const valid = results.length - invalid.length;

  await recordAuditLog({
    req,
    res,
    action: 'ID_IMAGE_LINKS_VERIFIED',
    entityType: 'employee',
    metadata: {
      checked: results.length,
      valid,
      invalid: invalid.length,
      limit,
      concurrency
    }
  });

  res.json({
    checked: results.length,
    valid,
    invalid: invalid.length,
    invalidItems: invalid
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

  if (existing.idImageUrl && existing.idImageUrl !== employee.idImageUrl) {
    await deleteLocalIdImage(existing.idImageUrl);
  }

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


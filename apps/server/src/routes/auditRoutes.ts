import { Router } from 'express';
import { prisma } from '../db/prisma';

export const auditRouter = Router();

const parseMetadata = (raw: string | null): unknown => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

auditRouter.get('/', async (req, res) => {
  const page = Number.parseInt(String(req.query.page ?? '1'), 10);
  const pageSize = Number.parseInt(String(req.query.pageSize ?? '50'), 10);
  const action = String(req.query.action ?? '').trim();
  const actorUsername = String(req.query.actorUsername ?? '').trim();

  const safePage = Number.isNaN(page) ? 1 : Math.max(1, page);
  const safePageSize = Number.isNaN(pageSize) ? 50 : Math.min(Math.max(10, pageSize), 200);
  const skip = (safePage - 1) * safePageSize;

  const where = {
    ...(action ? { action: { contains: action } } : {}),
    ...(actorUsername ? { actorUsername: { contains: actorUsername } } : {})
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: safePageSize
    }),
    prisma.auditLog.count({ where })
  ]);

  const parsedItems = items.map((item) => ({
    ...item,
    metadata: parseMetadata(item.metadataJson)
  }));

  const employeeIds = new Set<number>();
  for (const item of parsedItems) {
    const metadata = item.metadata;
    if (!metadata || typeof metadata !== 'object') {
      continue;
    }

    const rawEmployeeId = (metadata as Record<string, unknown>).employeeId;
    const parsedEmployeeId =
      typeof rawEmployeeId === 'number'
        ? rawEmployeeId
        : typeof rawEmployeeId === 'string'
          ? Number.parseInt(rawEmployeeId, 10)
          : Number.NaN;

    if (!Number.isNaN(parsedEmployeeId)) {
      employeeIds.add(parsedEmployeeId);
    }
  }

  const employees =
    employeeIds.size > 0
      ? await prisma.employee.findMany({
          where: {
            id: {
              in: [...employeeIds]
            }
          },
          select: {
            id: true,
            nickname: true,
            fullName: true,
            iban: true
          }
        })
      : [];
  const employeeById = new Map(
    employees.map((employee) => [employee.id, employee.nickname ?? employee.fullName ?? employee.iban ?? null])
  );

  res.json({
    items: parsedItems.map((item) => {
      const metadata = item.metadata;
      if (!metadata || typeof metadata !== 'object') {
        return item;
      }

      const metaObject = metadata as Record<string, unknown>;
      const rawEmployeeId = metaObject.employeeId;
      const parsedEmployeeId =
        typeof rawEmployeeId === 'number'
          ? rawEmployeeId
          : typeof rawEmployeeId === 'string'
            ? Number.parseInt(rawEmployeeId, 10)
            : Number.NaN;

      if (Number.isNaN(parsedEmployeeId)) {
        return item;
      }

      const employeeNickname = employeeById.get(parsedEmployeeId) ?? null;

      return {
        ...item,
        metadata: {
          ...metaObject,
          employeeNickname
        }
      };
    }),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize)
    }
  });
});

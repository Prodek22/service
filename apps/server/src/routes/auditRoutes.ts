import { Router } from 'express';
import { prisma } from '../db/prisma';

export const auditRouter = Router();

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

  res.json({
    items: items.map((item) => ({
      ...item,
      metadata: item.metadataJson ? (() => {
        try {
          return JSON.parse(item.metadataJson);
        } catch {
          return null;
        }
      })() : null
    })),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize)
    }
  });
});

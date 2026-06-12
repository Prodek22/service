import { Router } from 'express';
import { prisma } from '../db/prisma';

export const controlCheckRouter = Router();

controlCheckRouter.get('/', async (req, res) => {
  const parsedLimit = Number.parseInt(String(req.query.limit ?? '100'), 10);
  const limit = Number.isNaN(parsedLimit) ? 100 : Math.min(Math.max(parsedLimit, 1), 300);

  const items = await prisma.controlCheckLog.findMany({
    orderBy: {
      checkedAt: 'desc'
    },
    take: limit,
    select: {
      id: true,
      userDisplayName: true,
      checkedAt: true
    }
  });

  res.json({ items });
});

controlCheckRouter.get('/latest', async (_req, res) => {
  const latest = await prisma.controlCheckLog.findFirst({
    orderBy: {
      checkedAt: 'desc'
    },
    select: {
      id: true,
      userDisplayName: true,
      checkedAt: true
    }
  });

  res.json({ latest });
});

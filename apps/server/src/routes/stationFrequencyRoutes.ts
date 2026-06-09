import { Router } from 'express';
import { prisma } from '../db/prisma';

export const stationFrequencyRouter = Router();

stationFrequencyRouter.get('/logs', async (req, res) => {
  const parsedLimit = Number.parseInt(String(req.query.limit ?? '100'), 10);
  const limit = Number.isNaN(parsedLimit) ? 100 : Math.min(Math.max(parsedLimit, 1), 300);

  const items = await prisma.stationFrequencyLog.findMany({
    orderBy: {
      changedAt: 'desc'
    },
    take: limit
  });

  res.json({ items });
});

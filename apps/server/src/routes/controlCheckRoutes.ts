import { Router } from 'express';
import { prisma } from '../db/prisma';

export const controlCheckRouter = Router();

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

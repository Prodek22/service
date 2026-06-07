import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { normalizeAdminRole } from '../auth/roles';
import { prisma } from '../db/prisma';
import { recordAuditLog } from '../services/auditLogService';

export const adminUsersRouter = Router();

const sanitizeUser = (user: {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: user.id,
  username: user.username,
  role: normalizeAdminRole(user.role),
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

adminUsersRouter.get('/', async (_req, res) => {
  const users = await prisma.adminUser.findMany({
    orderBy: {
      username: 'asc'
    },
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true
    }
  });

  res.json({
    items: users.map(sanitizeUser)
  });
});

adminUsersRouter.post('/', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const role = normalizeAdminRole(req.body?.role ?? 'VIEWER');

  if (!username || !password) {
    res.status(400).json({ error: 'Username si parola sunt obligatorii.' });
    return;
  }

  if (username.length < 3 || username.length > 64) {
    res.status(400).json({ error: 'Username trebuie sa aiba intre 3 si 64 caractere.' });
    return;
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    res.status(400).json({ error: 'Username poate contine doar litere, cifre, punct, underscore sau minus.' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Parola trebuie sa aiba minim 8 caractere.' });
    return;
  }

  const existing = await prisma.adminUser.findUnique({
    where: {
      username
    },
    select: {
      id: true
    }
  });

  if (existing) {
    res.status(409).json({ error: 'Exista deja un user cu acest username.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.adminUser.create({
    data: {
      username,
      passwordHash,
      role,
      isActive: true
    },
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true
    }
  });

  await recordAuditLog({
    req,
    res,
    action: 'ADMIN_USER_CREATED',
    entityType: 'admin_user',
    entityId: user.id,
    metadata: {
      username: user.username,
      role
    }
  });

  res.status(201).json({
    item: sanitizeUser(user)
  });
});

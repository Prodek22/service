import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { normalizeAdminRole } from '../auth/roles';
import { AUTH_COOKIE_NAME, buildCookieOptions, signSessionToken, verifySessionToken } from '../auth/session';
import { prisma } from '../db/prisma';
import { recordAuditLog } from '../services/auditLogService';

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!username || !password) {
    res.status(400).json({ error: 'Username si parola sunt obligatorii' });
    return;
  }

  const user = await prisma.adminUser.findFirst({
    where: {
      username,
      isActive: true
    }
  });

  // Keep response timing closer for existing and non-existing users.
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordMatches) {
    res.status(401).json({ error: 'Credentiale invalide' });
    return;
  }

  const role = normalizeAdminRole(user.role);
  const token = signSessionToken({ username: user.username, role });
  res.locals.authUser = { username: user.username, role };

  await recordAuditLog({
    req,
    res,
    action: 'AUTH_LOGIN_SUCCESS',
    entityType: 'admin_user',
    entityId: user.id,
    metadata: {
      username: user.username,
      role
    }
  });

  res.cookie(AUTH_COOKIE_NAME, token, buildCookieOptions());
  res.json({ ok: true, username: user.username, role });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  const session = typeof token === 'string' ? verifySessionToken(token) : null;
  if (session) {
    res.locals.authUser = session;
    await recordAuditLog({
      req,
      res,
      action: 'AUTH_LOGOUT',
      entityType: 'session',
      entityId: session.username,
      metadata: {
        username: session.username,
        role: session.role
      }
    });
  }

  res.clearCookie(AUTH_COOKIE_NAME, {
    ...buildCookieOptions(),
    maxAge: 0
  });

  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token || typeof token !== 'string') {
    res.status(401).json({ authenticated: false });
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }

  res.status(200).json({
    authenticated: true,
    username: session.username,
    role: session.role
  });
});

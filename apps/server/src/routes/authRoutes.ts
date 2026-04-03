import crypto from 'crypto';
import { Router } from 'express';
import { AUTH_COOKIE_NAME, buildCookieOptions, signSessionToken, verifySessionToken } from '../auth/session';
import { env } from '../config/env';

const safeStringEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  const validUser = safeStringEqual(username, env.ADMIN_USERNAME);
  const validPass = safeStringEqual(password, env.ADMIN_PASSWORD);

  if (!validUser || !validPass) {
    res.status(401).json({ error: 'Credențiale invalide' });
    return;
  }

  const token = signSessionToken({ username });
  res.cookie(AUTH_COOKIE_NAME, token, buildCookieOptions());
  res.json({ ok: true, username });
});

authRouter.post('/logout', (_req, res) => {
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
    username: session.username
  });
});

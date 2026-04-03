import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const AUTH_COOKIE_NAME = 'service_admin_session';

export type SessionPayload = {
  username: string;
};

export const signSessionToken = (payload: SessionPayload): string =>
  jwt.sign(payload, env.AUTH_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '7d'
  });

export const verifySessionToken = (token: string): SessionPayload | null => {
  try {
    const decoded = jwt.verify(token, env.AUTH_JWT_SECRET) as SessionPayload;
    if (!decoded?.username) {
      return null;
    }

    return {
      username: decoded.username
    };
  } catch {
    return null;
  }
};

export const buildCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.AUTH_COOKIE_SECURE,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000
});

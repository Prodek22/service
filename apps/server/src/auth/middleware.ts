import { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, verifySessionToken } from './session';

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.locals.authUser = session;
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  requireAuth(req, res, () => {
    const role = String(res.locals.authUser?.role ?? '').toUpperCase();
    if (role !== 'ADMIN') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  });
};

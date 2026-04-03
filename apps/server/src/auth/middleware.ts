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

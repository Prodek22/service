import { Request, RequestHandler, Response, NextFunction } from 'express';

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type CreateRateLimiterInput = {
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
};

const getClientIp = (req: Request): string => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    const first = String(forwardedFor[0] ?? '').split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
};

export const createIpRateLimiter = (input: CreateRateLimiterInput): RequestHandler => {
  const windowMs = Math.max(1_000, input.windowMs);
  const maxRequests = Math.max(1, input.maxRequests);
  const keyPrefix = input.keyPrefix.trim() || 'global';
  const store = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;

    const existing = store.get(key);
    if (!existing || existing.resetAt <= now) {
      store.set(key, {
        count: 1,
        resetAt: now + windowMs
      });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests. Please slow down.',
        retryAfterSeconds
      });
      return;
    }

    existing.count += 1;
    store.set(key, existing);

    // Opportunistic cleanup to keep memory bounded.
    if (store.size > 2_000 && Math.random() < 0.02) {
      for (const [candidateKey, candidateValue] of store.entries()) {
        if (candidateValue.resetAt <= now) {
          store.delete(candidateKey);
        }
      }
    }

    next();
  };
};

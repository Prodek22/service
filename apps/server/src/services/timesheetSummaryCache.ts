type CacheEntry<T> = {
  payload: T;
  expiresAt: number;
};

const summaryCache = new Map<number, CacheEntry<Record<string, unknown>>>();

export const getTimesheetSummaryFromCache = (cycleId: number): Record<string, unknown> | null => {
  const cached = summaryCache.get(cycleId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    summaryCache.delete(cycleId);
    return null;
  }

  return cached.payload;
};

export const setTimesheetSummaryCache = (cycleId: number, payload: Record<string, unknown>, ttlMs: number): void => {
  const safeTtl = Math.max(1000, ttlMs);
  summaryCache.set(cycleId, {
    payload,
    expiresAt: Date.now() + safeTtl
  });
};

export const invalidateTimesheetSummaryCache = (cycleId?: number): void => {
  if (typeof cycleId === 'number') {
    summaryCache.delete(cycleId);
    return;
  }

  summaryCache.clear();
};


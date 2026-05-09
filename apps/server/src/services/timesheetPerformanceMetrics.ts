type SummaryMetricsState = {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  totalDurationMs: number;
  lastDurationMs: number | null;
  slowestDurationMs: number;
  lastUpdatedAt: Date | null;
};

const summaryMetrics: SummaryMetricsState = {
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  totalDurationMs: 0,
  lastDurationMs: null,
  slowestDurationMs: 0,
  lastUpdatedAt: null
};

export const recordTimesheetSummaryMetric = (input: { cacheHit: boolean; durationMs: number }): void => {
  const durationMs = Math.max(0, Math.round(input.durationMs));

  summaryMetrics.requests += 1;
  summaryMetrics.totalDurationMs += durationMs;
  summaryMetrics.lastDurationMs = durationMs;
  summaryMetrics.slowestDurationMs = Math.max(summaryMetrics.slowestDurationMs, durationMs);
  summaryMetrics.lastUpdatedAt = new Date();

  if (input.cacheHit) {
    summaryMetrics.cacheHits += 1;
  } else {
    summaryMetrics.cacheMisses += 1;
  }
};

export const getTimesheetSummaryMetrics = () => {
  const hitRate =
    summaryMetrics.requests > 0 ? Math.round((summaryMetrics.cacheHits / summaryMetrics.requests) * 100) : 0;
  const averageDurationMs =
    summaryMetrics.requests > 0 ? Math.round(summaryMetrics.totalDurationMs / summaryMetrics.requests) : 0;

  return {
    requests: summaryMetrics.requests,
    cacheHits: summaryMetrics.cacheHits,
    cacheMisses: summaryMetrics.cacheMisses,
    hitRate,
    averageDurationMs,
    lastDurationMs: summaryMetrics.lastDurationMs,
    slowestDurationMs: summaryMetrics.slowestDurationMs,
    lastUpdatedAt: summaryMetrics.lastUpdatedAt
  };
};

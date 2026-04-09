import { existsSync } from 'fs';
import path from 'path';
import { fork } from 'child_process';

export type MaintenanceJobType =
  | 'sync-new'
  | 'sync-timesheet-window'
  | 'rebuild-all'
  | 'sync-employees-incremental'
  | 'rebuild-cv-all'
  | 'cleanup-retention';

export type MaintenanceJobState = 'idle' | 'running' | 'success' | 'failed';

export type MaintenanceJobPayload = {
  latestLimitPerChannel?: number;
  days?: number;
  lookbackDays?: number;
  keepCycles?: number;
};

export type MaintenanceJobStatus = {
  id: string | null;
  type: MaintenanceJobType | null;
  state: MaintenanceJobState;
  progressPercent: number | null;
  progressMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

const status: MaintenanceJobStatus = {
  id: null,
  type: null,
  state: 'idle',
  progressPercent: null,
  progressMessage: null,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null
};

const resolveWorkerScript = (): string => {
  const distPath = path.resolve(process.cwd(), 'dist/scripts/maintenanceWorker.js');
  if (existsSync(distPath)) {
    return distPath;
  }

  throw new Error('Maintenance worker not found. Build server first (npm run build -w @gta-service/server).');
};

export const getMaintenanceStatus = (): MaintenanceJobStatus => ({ ...status });

export const startMaintenanceJob = (type: MaintenanceJobType, payload: MaintenanceJobPayload = {}): MaintenanceJobStatus => {
  if (status.state === 'running') {
    throw new Error('Un alt job de mentenanta ruleaza deja.');
  }

  const workerPath = resolveWorkerScript();
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  status.id = jobId;
  status.type = type;
  status.state = 'running';
  status.progressPercent = 0;
  status.progressMessage = 'Job pornit...';
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.result = null;
  status.error = null;

  const child = fork(workerPath, [], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MAINTENANCE_JOB_INPUT: JSON.stringify({ id: jobId, type, payload })
    },
    execArgv: ['--max-old-space-size=512'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });

  child.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }

    const data = message as { type?: string; payload?: Record<string, unknown> };

    if (data.type === 'job-progress') {
      const percentRaw = Number(data.payload?.percent ?? status.progressPercent ?? 0);
      status.progressPercent = Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, Math.round(percentRaw))) : 0;
      status.progressMessage = String(data.payload?.message ?? status.progressMessage ?? 'Job in desfasurare...');
      return;
    }

    if (data.type === 'job-success') {
      status.state = 'success';
      status.progressPercent = 100;
      status.progressMessage = 'Job finalizat.';
      status.result = data.payload ?? null;
      status.error = null;
      status.finishedAt = new Date().toISOString();
    }

    if (data.type === 'job-failed') {
      status.state = 'failed';
      status.progressMessage = 'Job eșuat.';
      status.result = null;
      status.error = String(data.payload?.error ?? 'Job failed');
      status.finishedAt = new Date().toISOString();
    }
  });

  child.on('exit', (code) => {
    if (status.state === 'running') {
      status.state = code === 0 ? 'success' : 'failed';
      status.finishedAt = new Date().toISOString();
      if (code !== 0 && !status.error) {
        status.error = `Worker exited with code ${code}`;
      }
    }
  });

  return getMaintenanceStatus();
};

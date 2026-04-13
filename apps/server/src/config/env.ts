import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  CV_CHANNEL_ID: z.string().min(1),
  TIMESHEET_CHANNEL_ID: z.string().min(1),
  EMPLOYEE_ROLE_ID: z.string().optional(),
  EMPLOYEE_ROLE_NAME: z.string().default('Angajat'),
  AUTH_JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  TIMESHEET_DAILY_SYNC_ENABLED: z.enum(['true', 'false']).default('true'),
  TIMESHEET_SYNC_INTERVAL_HOURS: z.string().default('24'),
  TIMESHEET_SYNC_DAYS: z.string().default('14'),
  AUTO_CLEANUP_ENABLED: z.enum(['true', 'false']).default('true'),
  AUTO_CLEANUP_INTERVAL_HOURS: z.string().default('720'),
  AUTO_CLEANUP_KEEP_CYCLES: z.string().default('12'),
  AUTO_CLEANUP_RUN_ON_START: z.enum(['true', 'false']).default('false'),
  BACKFILL_BATCH_DELAY_MS: z.string().default('120'),
  MAINTENANCE_WORKER_MAX_OLD_SPACE_MB: z.string().default('256'),
  DATABASE_URL: z.string().min(1),
  PORT: z.string().default('3001')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Missing or invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  PORT: Number(parsed.data.PORT),
  AUTH_COOKIE_SECURE: parsed.data.AUTH_COOKIE_SECURE === 'true',
  TIMESHEET_DAILY_SYNC_ENABLED: parsed.data.TIMESHEET_DAILY_SYNC_ENABLED === 'true',
  TIMESHEET_SYNC_INTERVAL_HOURS: Number.parseInt(parsed.data.TIMESHEET_SYNC_INTERVAL_HOURS, 10) || 24,
  TIMESHEET_SYNC_DAYS: Number.parseInt(parsed.data.TIMESHEET_SYNC_DAYS, 10) || 14,
  AUTO_CLEANUP_ENABLED: parsed.data.AUTO_CLEANUP_ENABLED === 'true',
  AUTO_CLEANUP_INTERVAL_HOURS: Number.parseInt(parsed.data.AUTO_CLEANUP_INTERVAL_HOURS, 10) || 720,
  AUTO_CLEANUP_KEEP_CYCLES: Math.max(6, Number.parseInt(parsed.data.AUTO_CLEANUP_KEEP_CYCLES, 10) || 12),
  AUTO_CLEANUP_RUN_ON_START: parsed.data.AUTO_CLEANUP_RUN_ON_START === 'true',
  BACKFILL_BATCH_DELAY_MS: Math.max(0, Number.parseInt(parsed.data.BACKFILL_BATCH_DELAY_MS, 10) || 120),
  MAINTENANCE_WORKER_MAX_OLD_SPACE_MB: Math.max(
    128,
    Math.min(2048, Number.parseInt(parsed.data.MAINTENANCE_WORKER_MAX_OLD_SPACE_MB, 10) || 256)
  )
};


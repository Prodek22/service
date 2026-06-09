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
  REACTION_TRACK_MESSAGE_IDS: z.string().default(''),
  AUTH_JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  TIMESHEET_DAILY_SYNC_ENABLED: z.enum(['true', 'false']).default('true'),
  TIMESHEET_SYNC_INTERVAL_HOURS: z.string().default('24'),
  TIMESHEET_SYNC_DAYS: z.string().default('14'),
  TIMESHEET_WARM_CACHE_ENABLED: z.enum(['true', 'false']).default('true'),
  TIMESHEET_WARM_CACHE_INTERVAL_SECONDS: z.string().default('45'),
  TIMESHEET_WARM_CACHE_CYCLES: z.string().default('4'),
  AUTO_CLEANUP_ENABLED: z.enum(['true', 'false']).default('true'),
  AUTO_CLEANUP_INTERVAL_HOURS: z.string().default('720'),
  AUTO_CLEANUP_KEEP_CYCLES: z.string().default('12'),
  AUTO_CLEANUP_RUN_ON_START: z.enum(['true', 'false']).default('false'),
  BACKFILL_BATCH_DELAY_MS: z.string().default('120'),
  MAINTENANCE_WORKER_MAX_OLD_SPACE_MB: z.string().default('256'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEETS_EMPLOYEES_TAB: z.string().default('Angajati'),
  SERVICE_COVERAGE_ENABLED: z.enum(['true', 'false']).default('false'),
  SERVICE_COVERAGE_EXTRA_CHANNEL_ID: z.string().default(''),
  SERVICE_COVERAGE_HELP_CHANNEL_ID: z.string().default(''),
  SERVICE_COVERAGE_HELP_ROLE_IDS: z.string().default(''),
  SERVICE_COVERAGE_MANAGER_ROLE_IDS: z.string().default(''),
  SERVICE_COVERAGE_MANAGER_USER_IDS: z.string().default(''),
  SERVICE_COVERAGE_PRECHECK_TIME: z.string().default('17:55'),
  SERVICE_COVERAGE_START_TIME: z.string().default('18:00'),
  SERVICE_COVERAGE_END_TIME: z.string().default('23:00'),
  SERVICE_COVERAGE_CHECK_INTERVAL_MINUTES: z.string().default('10'),
  SERVICE_COVERAGE_PRECHECK_MIN_MECHANICS: z.string().default('2'),
  SERVICE_COVERAGE_ALERT_COOLDOWN_MINUTES: z.string().default('9'),
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
  TIMESHEET_WARM_CACHE_ENABLED: parsed.data.TIMESHEET_WARM_CACHE_ENABLED === 'true',
  TIMESHEET_WARM_CACHE_INTERVAL_SECONDS:
    Math.max(10, Math.min(3600, Number.parseInt(parsed.data.TIMESHEET_WARM_CACHE_INTERVAL_SECONDS, 10) || 45)),
  TIMESHEET_WARM_CACHE_CYCLES: Math.max(2, Math.min(12, Number.parseInt(parsed.data.TIMESHEET_WARM_CACHE_CYCLES, 10) || 4)),
  AUTO_CLEANUP_ENABLED: parsed.data.AUTO_CLEANUP_ENABLED === 'true',
  AUTO_CLEANUP_INTERVAL_HOURS: Number.parseInt(parsed.data.AUTO_CLEANUP_INTERVAL_HOURS, 10) || 720,
  AUTO_CLEANUP_KEEP_CYCLES: Math.max(6, Number.parseInt(parsed.data.AUTO_CLEANUP_KEEP_CYCLES, 10) || 12),
  AUTO_CLEANUP_RUN_ON_START: parsed.data.AUTO_CLEANUP_RUN_ON_START === 'true',
  BACKFILL_BATCH_DELAY_MS: Math.max(0, Number.parseInt(parsed.data.BACKFILL_BATCH_DELAY_MS, 10) || 120),
  MAINTENANCE_WORKER_MAX_OLD_SPACE_MB: Math.max(
    128,
    Math.min(2048, Number.parseInt(parsed.data.MAINTENANCE_WORKER_MAX_OLD_SPACE_MB, 10) || 256)
  ),
  REACTION_TRACK_MESSAGE_IDS: parsed.data.REACTION_TRACK_MESSAGE_IDS
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  SERVICE_COVERAGE_ENABLED: parsed.data.SERVICE_COVERAGE_ENABLED === 'true',
  SERVICE_COVERAGE_HELP_ROLE_IDS: parsed.data.SERVICE_COVERAGE_HELP_ROLE_IDS
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  SERVICE_COVERAGE_MANAGER_ROLE_IDS: parsed.data.SERVICE_COVERAGE_MANAGER_ROLE_IDS
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  SERVICE_COVERAGE_MANAGER_USER_IDS: parsed.data.SERVICE_COVERAGE_MANAGER_USER_IDS
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  SERVICE_COVERAGE_CHECK_INTERVAL_MINUTES: Math.max(
    1,
    Math.min(60, Number.parseInt(parsed.data.SERVICE_COVERAGE_CHECK_INTERVAL_MINUTES, 10) || 10)
  ),
  SERVICE_COVERAGE_PRECHECK_MIN_MECHANICS: Math.max(
    1,
    Number.parseInt(parsed.data.SERVICE_COVERAGE_PRECHECK_MIN_MECHANICS, 10) || 2
  ),
  SERVICE_COVERAGE_ALERT_COOLDOWN_MINUTES: Math.max(
    1,
    Math.min(60, Number.parseInt(parsed.data.SERVICE_COVERAGE_ALERT_COOLDOWN_MINUTES, 10) || 9)
  )
};


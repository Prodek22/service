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
  AUTH_COOKIE_SECURE: parsed.data.AUTH_COOKIE_SECURE === 'true'
};


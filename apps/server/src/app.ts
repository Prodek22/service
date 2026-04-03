import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { requireAuth } from './auth/middleware';
import { env } from './config/env';
import { authRouter } from './routes/authRoutes';
import { dashboardRouter } from './routes/dashboardRoutes';
import { employeesRouter } from './routes/employeesRoutes';
import { healthRouter } from './routes/healthRoutes';
import { maintenanceRouter } from './routes/maintenanceRoutes';
import { timesheetRouter } from './routes/timesheetRoutes';

export const createApp = () => {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/timesheet', timesheetRouter);
  app.use('/api/maintenance', maintenanceRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
};


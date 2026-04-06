import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { requireAdmin, requireAuth, requirePdkAuditAccess } from './auth/middleware';
import { env } from './config/env';
import { auditRouter } from './routes/auditRoutes';
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
  app.use('/api/audit', requirePdkAuditAccess, auditRouter);
  app.use('/api/timesheet', timesheetRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/employees', requireAuth, employeesRouter);
  app.use('/api/maintenance', requireAdmin, maintenanceRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
};



import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { requireAdmin, requireAuth, requirePdkAuditAccess } from './auth/middleware';
import { env } from './config/env';
import { adminUsersRouter } from './routes/adminUsersRoutes';
import { auditRouter } from './routes/auditRoutes';
import { authRouter } from './routes/authRoutes';
import { dashboardRouter } from './routes/dashboardRoutes';
import { employeesRouter } from './routes/employeesRoutes';
import { healthRouter } from './routes/healthRoutes';
import { maintenanceRouter } from './routes/maintenanceRoutes';
import { reactionRouter } from './routes/reactionRoutes';
import { stationFrequencyRouter } from './routes/stationFrequencyRoutes';
import { timesheetRouter } from './routes/timesheetRoutes';
import { getIdImageStaticDirs, ID_IMAGE_PUBLIC_BASE_PATH } from './services/idImageStorage';

export const createApp = () => {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  for (const staticDir of getIdImageStaticDirs()) {
    app.use(ID_IMAGE_PUBLIC_BASE_PATH, express.static(staticDir));
  }

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/audit', requirePdkAuditAccess, auditRouter);
  app.use('/api/admin-users', requirePdkAuditAccess, adminUsersRouter);
  app.use('/api/station-frequency', requirePdkAuditAccess, stationFrequencyRouter);
  app.use('/api/timesheet', timesheetRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/employees', requireAuth, employeesRouter);
  app.use('/api/maintenance', requireAdmin, maintenanceRouter);
  app.use('/api/reactions', requireAdmin, reactionRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
};



import cors from 'cors';
import express from 'express';
import { dashboardRouter } from './routes/dashboardRoutes';
import { employeesRouter } from './routes/employeesRoutes';
import { healthRouter } from './routes/healthRoutes';
import { timesheetRouter } from './routes/timesheetRoutes';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/timesheet', timesheetRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
};


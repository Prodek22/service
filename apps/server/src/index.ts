import { createApp } from './app';
import { startDiscordBot } from './bot/discordBot';
import { env } from './config/env';
import { prisma } from './db/prisma';
import { startTimesheetSyncScheduler, stopTimesheetSyncScheduler } from './services/timesheetSyncScheduler';

const bootstrap = async () => {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(`API listening on http://0.0.0.0:${env.PORT}`);
  });

  const botClient = await startDiscordBot();
  startTimesheetSyncScheduler();

  const shutdown = async () => {
    console.log('Shutting down...');
    stopTimesheetSyncScheduler();
    botClient.destroy();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

bootstrap().catch(async (error) => {
  console.error('Fatal bootstrap error', error);
  await prisma.$disconnect();
  process.exit(1);
});


import { TimeEventType } from '@prisma/client';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { runBackfill } from '../services/backfillRunner';
import { createGuildMemberFilter } from '../services/guildMemberFilter';

type WorkerInput = {
  id: string;
  type: 'sync-new' | 'sync-timesheet-window' | 'rebuild-all' | 'sync-employees-incremental';
  payload?: {
    latestLimitPerChannel?: number;
    days?: number;
    lookbackDays?: number;
  };
};

const getInput = (): WorkerInput => {
  const raw = process.env.MAINTENANCE_JOB_INPUT;
  if (!raw) {
    throw new Error('Missing MAINTENANCE_JOB_INPUT');
  }

  return JSON.parse(raw) as WorkerInput;
};

const pruneGhostWeekCycles = async (): Promise<number> => {
  const deleted = await prisma.$executeRawUnsafe(`
    DELETE wc
    FROM week_cycles wc
    LEFT JOIN time_events te
      ON te.week_cycle_id = wc.id
      AND te.is_deleted = 0
      AND te.event_type IN ('CLOCK_IN', 'CLOCK_OUT', 'MANUAL_ADJUSTMENT')
    WHERE wc.ended_at IS NOT NULL
      AND wc.ended_at <= wc.started_at
      AND te.id IS NULL
  `);

  return Number(deleted) || 0;
};

const runIncrementalEmployeeSync = async (lookbackDaysInput?: number) => {
  const lookbackDays = Math.max(1, Math.min(lookbackDaysInput ?? 14, 60));

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember]
  });

  try {
    await client.login(env.DISCORD_TOKEN);
    const memberFilter = await createGuildMemberFilter(client);
    const roster = await memberFilter.listEmployeeMembers();
    const rosterIds = new Set(roster.map((member) => member.userId));

    const staleUsers = await prisma.employee.findMany({
      where: {
        discordUserId: {
          not: null
        },
        NOT: {
          discordUserId: {
            in: [...rosterIds]
          }
        }
      },
      select: {
        id: true,
        discordUserId: true
      }
    });

    const staleIds = staleUsers.map((employee) => employee.id);
    const staleDiscordUserIds = staleUsers
      .map((employee) => employee.discordUserId)
      .filter((value): value is string => Boolean(value));

    let deletedTimeEvents = 0;
    if (staleIds.length || staleDiscordUserIds.length) {
      const result = await prisma.timeEvent.deleteMany({
        where: {
          eventType: {
            in: [TimeEventType.CLOCK_IN, TimeEventType.CLOCK_OUT, TimeEventType.MANUAL_ADJUSTMENT]
          },
          OR: [
            ...(staleIds.length
              ? [
                  {
                    targetEmployeeId: {
                      in: staleIds
                    }
                  }
                ]
              : []),
            ...(staleDiscordUserIds.length
              ? [
                  {
                    discordUserId: {
                      in: staleDiscordUserIds
                    }
                  }
                ]
              : [])
          ]
        }
      });

      deletedTimeEvents = result.count;
    }

    let deletedEmployees = 0;
    if (staleIds.length) {
      const result = await prisma.employee.deleteMany({
        where: {
          id: {
            in: staleIds
          }
        }
      });
      deletedEmployees = result.count;
    }

    let updatedProfiles = 0;
    for (const member of roster) {
      const profileUpdate: {
        nickname?: string;
        rank?: string;
        cvPostedAt?: Date;
      } = {};

      if (member.rpNickname) {
        profileUpdate.nickname = member.rpNickname;
      }

      if (member.cvRank) {
        profileUpdate.rank = member.cvRank;
      }

      if (member.joinedAt) {
        profileUpdate.cvPostedAt = member.joinedAt;
      }

      if (!Object.keys(profileUpdate).length) {
        continue;
      }

      const updated = await prisma.employee.updateMany({
        where: {
          discordUserId: member.userId
        },
        data: profileUpdate
      });

      updatedProfiles += updated.count;
    }

    const latestCv = await prisma.employee.findFirst({
      where: {
        cvPostedAt: {
          not: null
        }
      },
      orderBy: {
        cvPostedAt: 'desc'
      },
      select: {
        cvPostedAt: true
      }
    });

    const sinceDate = latestCv?.cvPostedAt
      ? new Date(latestCv.cvPostedAt.getTime() - 6 * 60 * 60 * 1000)
      : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const backfillResult = await runBackfill({
      mode: 'since',
      sinceDate,
      channels: ['cv']
    });
    const deletedGhostCycles = await pruneGhostWeekCycles();

    return {
      mode: 'incremental-employees',
      lookbackDays,
      sinceDate: sinceDate.toISOString(),
      rosterCount: roster.length,
      deletedTimeEvents,
      deletedEmployees,
      deletedGhostCycles,
      updatedProfiles,
      processed: backfillResult
    };
  } finally {
    client.destroy();
  }
};

const run = async () => {
  const input = getInput();

  if (input.type === 'sync-employees-incremental') {
    const result = await runIncrementalEmployeeSync(input.payload?.lookbackDays);

    process.send?.({
      type: 'job-success',
      payload: result
    });

    return;
  }

  if (input.type === 'sync-new') {
    const latestLimitPerChannel = Math.max(1, Math.min(input.payload?.latestLimitPerChannel ?? 100, 100));
    const result = await runBackfill({
      mode: 'latest',
      latestLimitPerChannel
    });
    const deletedGhostCycles = await pruneGhostWeekCycles();

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'latest',
        latestLimitPerChannel,
        deletedGhostCycles,
        processed: result
      }
    });

    return;
  }

  if (input.type === 'sync-timesheet-window') {
    const days = Math.max(1, Math.min(input.payload?.days ?? 14, 90));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await runBackfill({
      mode: 'since',
      sinceDate,
      channels: ['timesheet']
    });
    const deletedGhostCycles = await pruneGhostWeekCycles();

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'since',
        days,
        deletedGhostCycles,
        processed: result
      }
    });

    return;
  }

  if (input.type === 'rebuild-all') {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE time_events');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE week_cycles');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employee_cv_raw');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employee_aliases');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE employees');
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');

    const result = await runBackfill({ mode: 'all' });
    const deletedGhostCycles = await pruneGhostWeekCycles();

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'all',
        deleted: 'all-operational-data',
        deletedGhostCycles,
        processed: result
      }
    });

    return;
  }

  throw new Error(`Unsupported maintenance job type: ${input.type}`);
};

run()
  .catch(async (error) => {
    try {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    } catch {
      // noop
    }

    process.send?.({
      type: 'job-failed',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown worker error'
      }
    });

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

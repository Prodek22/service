import { TimeEventType } from '@prisma/client';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { BackfillProgress, runBackfill } from '../services/backfillRunner';
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

const toPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const sendProgress = (percent: number, message: string, extra: Record<string, unknown> = {}) => {
  process.send?.({
    type: 'job-progress',
    payload: {
      percent: toPercent(percent),
      message,
      ...extra
    }
  });
};

const emitBackfillProgress = (progress: BackfillProgress, rangeStart: number, rangeEnd: number) => {
  const batchFactor = Math.min(progress.batches, 30) / 30;
  const percent = rangeStart + (rangeEnd - rangeStart) * batchFactor;
  const channelLabel = progress.channel === 'cv' ? 'CV' : 'pontaje';

  sendProgress(percent, `Backfill ${channelLabel}: ${progress.accepted} acceptate din ${progress.scanned} mesaje.`);
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

const normalizeWeekCycleBoundaries = async (): Promise<number> => {
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE week_cycles wc
    JOIN (
      SELECT
        base.id,
        (
          SELECT nxt.started_at
          FROM week_cycles nxt
          WHERE nxt.service_code = base.service_code
            AND nxt.reset_message_id IS NOT NULL
            AND (
              nxt.started_at > base.started_at
              OR (nxt.started_at = base.started_at AND nxt.id > base.id)
            )
          ORDER BY nxt.started_at ASC, nxt.id ASC
          LIMIT 1
        ) AS computed_end
      FROM week_cycles base
      WHERE base.reset_message_id IS NOT NULL
    ) calc ON calc.id = wc.id
    SET wc.ended_at = calc.computed_end
    WHERE wc.reset_message_id IS NOT NULL
      AND (
        (wc.ended_at IS NULL AND calc.computed_end IS NOT NULL)
        OR (wc.ended_at IS NOT NULL AND calc.computed_end IS NULL)
        OR (wc.ended_at IS NOT NULL AND calc.computed_end IS NOT NULL AND wc.ended_at <> calc.computed_end)
      )
  `);

  return Number(updated) || 0;
};

const normalizeTimesheetCycleAssignments = async (): Promise<number> => {
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE time_events te
    JOIN (
      SELECT
        e.id AS event_id,
        COALESCE(
          (
            SELECT wc.id
            FROM week_cycles wc
            WHERE wc.service_code = COALESCE(e.service_code, 'service')
              AND wc.reset_message_id IS NOT NULL
              AND wc.started_at <= e.event_at
              AND (wc.ended_at IS NULL OR wc.ended_at > e.event_at)
            ORDER BY wc.started_at DESC, wc.id DESC
            LIMIT 1
          ),
          (
            SELECT wc.id
            FROM week_cycles wc
            WHERE wc.service_code = COALESCE(e.service_code, 'service')
              AND wc.started_at <= e.event_at
              AND (wc.ended_at IS NULL OR wc.ended_at > e.event_at)
            ORDER BY wc.started_at DESC, wc.id DESC
            LIMIT 1
          )
        ) AS resolved_cycle_id
      FROM time_events e
      WHERE e.is_deleted = 0
        AND e.event_type IN ('CLOCK_IN', 'CLOCK_OUT', 'MANUAL_ADJUSTMENT')
    ) resolved ON resolved.event_id = te.id
    SET te.week_cycle_id = resolved.resolved_cycle_id
    WHERE resolved.resolved_cycle_id IS NOT NULL
      AND (te.week_cycle_id IS NULL OR te.week_cycle_id <> resolved.resolved_cycle_id)
  `);

  return Number(updated) || 0;
};

const snapshotMissingEventRanks = async (): Promise<number> => {
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE time_events te
    JOIN employees e ON e.id = te.target_employee_id
    SET te.target_employee_rank = e.rank
    WHERE te.target_employee_rank IS NULL
      AND te.target_employee_id IS NOT NULL
      AND te.is_deleted = 0
      AND te.event_type IN ('CLOCK_IN', 'CLOCK_OUT', 'MANUAL_ADJUSTMENT')
  `);

  return Number(updated) || 0;
};

const pruneNonResetWeekCycles = async (): Promise<number> => {
  const deleted = await prisma.$executeRawUnsafe(`
    DELETE wc
    FROM week_cycles wc
    LEFT JOIN time_events te
      ON te.week_cycle_id = wc.id
      AND te.is_deleted = 0
    WHERE wc.reset_message_id IS NULL
      AND te.id IS NULL
  `);

  return Number(deleted) || 0;
};

const normalizeTimesheetData = async (): Promise<{
  normalizedWeekCycleBoundaries: number;
  deletedGhostCycles: number;
  reassignedCycleEvents: number;
  deletedNonResetCycles: number;
  snapshottedEventRanks: number;
}> => {
  const normalizedWeekCycleBoundaries = await normalizeWeekCycleBoundaries();
  const deletedGhostCycles = await pruneGhostWeekCycles();
  const reassignedCycleEvents = await normalizeTimesheetCycleAssignments();
  const snapshottedEventRanks = await snapshotMissingEventRanks();
  const deletedNonResetCycles = await pruneNonResetWeekCycles();

  return {
    normalizedWeekCycleBoundaries,
    deletedGhostCycles,
    reassignedCycleEvents,
    deletedNonResetCycles,
    snapshottedEventRanks
  };
};

const runIncrementalEmployeeSync = async (lookbackDaysInput?: number) => {
  const lookbackDays = Math.max(1, Math.min(lookbackDaysInput ?? 14, 60));

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember]
  });

  try {
    sendProgress(5, 'Conectare Discord pentru sync incremental angajati...');
    await client.login(env.DISCORD_TOKEN);
    const memberFilter = await createGuildMemberFilter(client);
    const roster = await memberFilter.listEmployeeMembers();
    sendProgress(20, `Lista angajati preluata (${roster.length} membri cu rol Angajat).`);
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

    sendProgress(55, `Reimport CV incremental din ${sinceDate.toLocaleString('ro-RO')}...`);

    const backfillResult = await runBackfill({
      mode: 'since',
      sinceDate,
      channels: ['cv'],
      onProgress: (progress) => emitBackfillProgress(progress, 55, 88)
    });
    sendProgress(92, 'Normalizare date dupa sync incremental...');
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
    sendProgress(2, 'Pornire sync incremental angajati...');
    const result = await runIncrementalEmployeeSync(input.payload?.lookbackDays);

    process.send?.({
      type: 'job-success',
      payload: result
    });

    return;
  }

  if (input.type === 'sync-new') {
    sendProgress(2, 'Pornire sync mesaje noi...');
    const latestLimitPerChannel = Math.max(1, Math.min(input.payload?.latestLimitPerChannel ?? 100, 100));
    const result = await runBackfill({
      mode: 'latest',
      latestLimitPerChannel,
      onProgress: (progress) => emitBackfillProgress(progress, 20, 80)
    });
    sendProgress(86, 'Normalizare cicluri si reasignare pontaje...');
    const normalized = await normalizeTimesheetData();

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'latest',
        latestLimitPerChannel,
        normalizedWeekCycleBoundaries: normalized.normalizedWeekCycleBoundaries,
        deletedGhostCycles: normalized.deletedGhostCycles,
        reassignedCycleEvents: normalized.reassignedCycleEvents,
        deletedNonResetCycles: normalized.deletedNonResetCycles,
        snapshottedEventRanks: normalized.snapshottedEventRanks,
        processed: result
      }
    });

    return;
  }

  if (input.type === 'sync-timesheet-window') {
    sendProgress(2, 'Pornire sync pontaje saptamana in curs...');
    const days = Math.max(1, Math.min(input.payload?.days ?? 14, 90));
    const fallbackSinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const latestStored = await prisma.timeEvent.findFirst({
      where: {
        channelId: env.TIMESHEET_CHANNEL_ID
      },
      orderBy: {
        eventAt: 'desc'
      },
      select: {
        eventAt: true
      }
    });

    // Incremental sync from the newest stored point, with overlap buffer to avoid misses.
    const incrementalSinceDate = latestStored?.eventAt
      ? new Date(latestStored.eventAt.getTime() - 6 * 60 * 60 * 1000)
      : fallbackSinceDate;
    const openCycle = await prisma.weekCycle.findFirst({
      where: {
        endedAt: null
      },
      orderBy: {
        startedAt: 'desc'
      },
      select: {
        startedAt: true
      }
    });
    const openCycleSinceDate = openCycle?.startedAt
      ? new Date(openCycle.startedAt.getTime() - 60 * 60 * 1000)
      : null;

    const sinceDate = openCycleSinceDate
      ? openCycleSinceDate
      : incrementalSinceDate.getTime() > fallbackSinceDate.getTime()
        ? incrementalSinceDate
        : fallbackSinceDate;

    const result = await runBackfill({
      mode: 'since',
      sinceDate,
      channels: ['timesheet'],
      onProgress: (progress) => emitBackfillProgress(progress, 22, 82)
    });
    sendProgress(88, 'Normalizare cicluri si reasignare pontaje...');
    const normalized = await normalizeTimesheetData();

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'since',
        days,
        sinceDate: sinceDate.toISOString(),
        normalizedWeekCycleBoundaries: normalized.normalizedWeekCycleBoundaries,
        deletedGhostCycles: normalized.deletedGhostCycles,
        reassignedCycleEvents: normalized.reassignedCycleEvents,
        deletedNonResetCycles: normalized.deletedNonResetCycles,
        snapshottedEventRanks: normalized.snapshottedEventRanks,
        processed: result
      }
    });

    return;
  }

  if (input.type === 'rebuild-all') {
    sendProgress(2, 'Pornire reset complet...');
    sendProgress(8, 'Stergere date operationale existente...');
    await prisma.$transaction([
      prisma.timeEvent.deleteMany({}),
      prisma.timesheetPayrollStatus.deleteMany({}),
      prisma.weekCycle.deleteMany({}),
      prisma.employeeCvRaw.deleteMany({}),
      prisma.employeeAlias.deleteMany({}),
      prisma.employee.deleteMany({})
    ]);

    sendProgress(15, 'Date sterse. Incepe reimportul complet...');

    const result = await runBackfill({
      mode: 'all',
      onProgress: (progress) => {
        if (progress.channel === 'cv') {
          emitBackfillProgress(progress, 20, 55);
          return;
        }

        emitBackfillProgress(progress, 55, 85);
      }
    });
    sendProgress(90, 'Reimport finalizat. Se normalizeaza ciclurile...');
    const normalized = await normalizeTimesheetData();
    sendProgress(97, 'Ultime verificari inainte de finalizare...');

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'all',
        deleted: 'all-operational-data',
        normalizedWeekCycleBoundaries: normalized.normalizedWeekCycleBoundaries,
        deletedGhostCycles: normalized.deletedGhostCycles,
        reassignedCycleEvents: normalized.reassignedCycleEvents,
        deletedNonResetCycles: normalized.deletedNonResetCycles,
        snapshottedEventRanks: normalized.snapshottedEventRanks,
        processed: result
      }
    });

    return;
  }

  throw new Error(`Unsupported maintenance job type: ${input.type}`);
};

run()
  .catch(async (error) => {
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

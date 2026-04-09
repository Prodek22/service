import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { EmployeeStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { BackfillProgress, runBackfill } from '../services/backfillRunner';
import { createGuildMemberFilter } from '../services/guildMemberFilter';
import { deleteLocalIdImage, isLocalIdImageUrl, purgeLocalIdImageStorage, saveIdImageLocally } from '../services/idImageStorage';
import { runRetentionCleanup } from '../services/maintenanceCleanupService';

type WorkerInput = {
  id: string;
  type:
    | 'sync-new'
    | 'sync-timesheet-window'
    | 'rebuild-all'
    | 'sync-employees-incremental'
    | 'rebuild-cv-all'
    | 'cleanup-retention';
  payload?: {
    latestLimitPerChannel?: number;
    days?: number;
    lookbackDays?: number;
    keepCycles?: number;
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
    WHERE
      (resolved.resolved_cycle_id IS NOT NULL AND (te.week_cycle_id IS NULL OR te.week_cycle_id <> resolved.resolved_cycle_id))
      OR
      (resolved.resolved_cycle_id IS NULL AND te.week_cycle_id IS NOT NULL)
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
    const rosterIdList = [...rosterIds];

    const staleUsers = await prisma.employee.findMany({
      where: {
        discordUserId: {
          not: null
        },
        status: {
          not: EmployeeStatus.DELETED
        },
        NOT: {
          discordUserId: {
            in: rosterIdList
          }
        }
      },
      select: {
        id: true,
        discordUserId: true,
        idImageUrl: true
      }
    });

    const staleUsersWithImages = await prisma.employee.findMany({
      where: {
        discordUserId: {
          not: null
        },
        idImageUrl: {
          not: null
        },
        NOT: {
          discordUserId: {
            in: rosterIdList
          }
        }
      },
      select: {
        id: true,
        idImageUrl: true
      }
    });

    const staleEmployeeIds = staleUsers.map((user) => user.id);
    const staleUsersCount = staleUsers.length;
    let removedLocalIdImages = 0;
    for (const staleUser of staleUsersWithImages) {
      const removed = await deleteLocalIdImage(staleUser.idImageUrl);
      if (removed) {
        removedLocalIdImages += 1;
      }
    }

    if (staleUsersWithImages.length > 0) {
      await prisma.employee.updateMany({
        where: {
          id: {
            in: staleUsersWithImages.map((item) => item.id)
          }
        },
        data: {
          idImageUrl: null
        }
      });
    }

    const staleMarkedDeleted =
      staleEmployeeIds.length > 0
        ? await prisma.employee.updateMany({
            where: {
              id: {
                in: staleEmployeeIds
              }
            },
            data: {
              status: EmployeeStatus.DELETED,
              idImageUrl: null,
              deletedAt: new Date()
            }
          })
        : { count: 0 };

    sendProgress(
      30,
      `Curatare roster: ${staleMarkedDeleted.count} marcati DELETED imediat, ${removedLocalIdImages} imagini sterse.`
    );

    let updatedProfiles = 0;
    for (const member of roster) {
      const profileUpdate: {
        nickname?: string;
        rank?: string;
        cvPostedAt?: Date;
        deletedAt?: null;
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
      profileUpdate.deletedAt = null;

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

    sendProgress(42, 'Convertire imagini de buletin ramase pe link Discord in storage local...');
    const remoteImageRows = await prisma.employee.findMany({
      where: {
        status: {
          not: EmployeeStatus.DELETED
        },
        discordUserId: {
          in: rosterIdList
        },
        idImageUrl: {
          not: null
        }
      },
      select: {
        id: true,
        idImageUrl: true
      }
    });

    let localizedImages = 0;
    let failedImageLocalization = 0;
    for (const row of remoteImageRows) {
      const currentUrl = row.idImageUrl;
      if (!currentUrl || isLocalIdImageUrl(currentUrl)) {
        continue;
      }

      try {
        const localizedUrl = await saveIdImageLocally({ url: currentUrl });
        if (localizedUrl && localizedUrl !== currentUrl) {
          await prisma.employee.update({
            where: {
              id: row.id
            },
            data: {
              idImageUrl: localizedUrl
            }
          });
          localizedImages += 1;
        }
      } catch (error) {
        failedImageLocalization += 1;
        console.warn(`[maintenance] failed to localize id image for employee ${row.id}`, error);
      }
    }

    const latestCvRaw = await prisma.employeeCvRaw.findFirst({
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        createdAt: true
      }
    });

    const fallbackSinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const sinceDate = latestCvRaw?.createdAt
      ? new Date(Math.min(latestCvRaw.createdAt.getTime() - 24 * 60 * 60 * 1000, fallbackSinceDate.getTime()))
      : fallbackSinceDate;

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
      staleUsersCount,
      markedDeletedEmployees: staleMarkedDeleted.count,
      removedLocalIdImages,
      reactivatedEmployees: 0,
      deletedTimeEvents: 0,
      deletedEmployees: 0,
      deletedGhostCycles,
      updatedProfiles,
      localizedImages,
      failedImageLocalization,
      processed: backfillResult
    };
  } finally {
    client.destroy();
  }
};

const runCvRebuildAll = async () => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember]
  });

  try {
    sendProgress(5, 'Conectare Discord pentru rebuild CV-uri...');
    await client.login(env.DISCORD_TOKEN);
    const memberFilter = await createGuildMemberFilter(client);
    const roster = await memberFilter.listEmployeeMembers();
    sendProgress(18, `Lista angajati preluata (${roster.length} membri cu rol Angajat).`);
    const rosterIds = new Set(roster.map((member) => member.userId));
    const rosterIdList = [...rosterIds];

    const staleUsers = await prisma.employee.findMany({
      where: {
        discordUserId: {
          not: null
        },
        status: {
          not: EmployeeStatus.DELETED
        },
        NOT: {
          discordUserId: {
            in: rosterIdList
          }
        }
      },
      select: {
        id: true,
        idImageUrl: true
      }
    });

    let removedLocalIdImages = 0;
    for (const staleUser of staleUsers) {
      const removed = await deleteLocalIdImage(staleUser.idImageUrl);
      if (removed) {
        removedLocalIdImages += 1;
      }
    }

    const staleMarkedDeleted =
      staleUsers.length > 0
        ? await prisma.employee.updateMany({
            where: {
              id: {
                in: staleUsers.map((user) => user.id)
              }
            },
            data: {
              status: EmployeeStatus.DELETED,
              idImageUrl: null,
              deletedAt: new Date()
            }
          })
        : { count: 0 };

    sendProgress(
      28,
      `Curatare roster: ${staleMarkedDeleted.count} marcati DELETED, ${removedLocalIdImages} imagini sterse.`
    );

    let updatedProfiles = 0;
    for (const member of roster) {
      const profileUpdate: {
        nickname?: string;
        rank?: string;
        cvPostedAt?: Date;
        deletedAt?: null;
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
      profileUpdate.deletedAt = null;

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

    sendProgress(36, 'Reprocesare completa canal CV...');
    const backfillResult = await runBackfill({
      mode: 'all',
      channels: ['cv'],
      onProgress: (progress) => emitBackfillProgress(progress, 36, 88)
    });

    sendProgress(90, 'Localizare imagini ramase pe link Discord...');
    const remoteImageRows = await prisma.employee.findMany({
      where: {
        status: {
          not: EmployeeStatus.DELETED
        },
        discordUserId: {
          in: rosterIdList
        },
        idImageUrl: {
          not: null
        }
      },
      select: {
        id: true,
        idImageUrl: true
      }
    });

    let localizedImages = 0;
    let failedImageLocalization = 0;
    for (const row of remoteImageRows) {
      const currentUrl = row.idImageUrl;
      if (!currentUrl || isLocalIdImageUrl(currentUrl)) {
        continue;
      }

      try {
        const localizedUrl = await saveIdImageLocally({ url: currentUrl });
        if (localizedUrl && localizedUrl !== currentUrl) {
          await prisma.employee.update({
            where: {
              id: row.id
            },
            data: {
              idImageUrl: localizedUrl
            }
          });
          localizedImages += 1;
        }
      } catch (error) {
        failedImageLocalization += 1;
        console.warn(`[maintenance] failed to localize id image for employee ${row.id}`, error);
      }
    }

    return {
      mode: 'rebuild-cv-all',
      rosterCount: roster.length,
      markedDeletedEmployees: staleMarkedDeleted.count,
      removedLocalIdImages,
      updatedProfiles,
      localizedImages,
      failedImageLocalization,
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

  if (input.type === 'rebuild-cv-all') {
    sendProgress(2, 'Pornire rebuild complet CV-uri...');
    const result = await runCvRebuildAll();

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

  if (input.type === 'cleanup-retention') {
    const keepCycles = Math.max(6, Math.min(input.payload?.keepCycles ?? env.AUTO_CLEANUP_KEEP_CYCLES, 260));
    sendProgress(5, `Pornire cleanup retention. Pastrez ultimele ${keepCycles} cicluri per service...`);
    const result = await runRetentionCleanup(keepCycles);
    sendProgress(100, 'Cleanup retention finalizat.');

    process.send?.({
      type: 'job-success',
      payload: {
        mode: 'cleanup-retention',
        ...result
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
    await purgeLocalIdImageStorage();
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

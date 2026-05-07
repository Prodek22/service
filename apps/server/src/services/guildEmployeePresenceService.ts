import { GuildMember } from 'discord.js';
import { getDiscordClient } from '../bot/clientStore';
import { env } from '../config/env';
import { normalizeForCompare } from '../utils/normalize';

type CacheEntry = {
  checkedAt: number;
  hasEmployeeRole: boolean;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

const roleNameNormalized = normalizeForCompare(env.EMPLOYEE_ROLE_NAME);

const memberHasEmployeeRole = (member: GuildMember): boolean => {
  if (env.EMPLOYEE_ROLE_ID && member.roles.cache.has(env.EMPLOYEE_ROLE_ID)) {
    return true;
  }

  return member.roles.cache.some((role) => normalizeForCompare(role.name) === roleNameNormalized);
};

const isFresh = (entry: CacheEntry | undefined): entry is CacheEntry => {
  if (!entry) {
    return false;
  }

  return Date.now() - entry.checkedAt < CACHE_TTL_MS;
};

const mapLimit = async <T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) => {
  const safeConcurrency = Math.max(1, Math.min(concurrency, 20));
  let cursor = 0;

  const runners = Array.from({ length: Math.min(safeConcurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });

  await Promise.all(runners);
};

export const resolveGuildEmployeeRolePresence = async (
  userIds: string[]
): Promise<Record<string, boolean>> => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const result: Record<string, boolean> = {};

  if (!uniqueUserIds.length) {
    return result;
  }

  const client = getDiscordClient();
  if (!client) {
    return result;
  }

  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID).catch(() => null));
  if (!guild) {
    return result;
  }

  const missing: string[] = [];
  for (const userId of uniqueUserIds) {
    const entry = cache.get(userId);
    if (isFresh(entry)) {
      result[userId] = entry.hasEmployeeRole;
      continue;
    }

    missing.push(userId);
  }

  await mapLimit(missing, 8, async (userId) => {
    try {
      const member = await guild.members.fetch(userId);
      const hasEmployeeRole = memberHasEmployeeRole(member);
      cache.set(userId, {
        checkedAt: Date.now(),
        hasEmployeeRole
      });
      result[userId] = hasEmployeeRole;
    } catch {
      cache.set(userId, {
        checkedAt: Date.now(),
        hasEmployeeRole: false
      });
      result[userId] = false;
    }
  });

  return result;
};

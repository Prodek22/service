import { GuildMember } from 'discord.js';
import { getDiscordClient } from '../bot/clientStore';
import { env } from '../config/env';

type AvatarCacheEntry = {
  url: string;
  cachedAt: number;
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_CONCURRENCY = 8;
const avatarCache = new Map<string, AvatarCacheEntry>();

const getCachedAvatar = (discordUserId: string): string | null => {
  const entry = avatarCache.get(discordUserId);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    avatarCache.delete(discordUserId);
    return null;
  }

  return entry.url;
};

const setCachedAvatar = (discordUserId: string, url: string): void => {
  avatarCache.set(discordUserId, {
    url,
    cachedAt: Date.now()
  });
};

const toAvatarUrl = (member: GuildMember): string =>
  member.displayAvatarURL({
    extension: 'png',
    size: 128
  });

export const resolveDiscordAvatarMap = async (discordUserIds: string[]): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const uniqueIds = [...new Set(discordUserIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return result;
  }

  for (const id of uniqueIds) {
    const cached = getCachedAvatar(id);
    if (cached) {
      result[id] = cached;
    }
  }

  const missing = uniqueIds.filter((id) => !result[id]);
  if (!missing.length) {
    return result;
  }

  const client = getDiscordClient();
  if (!client) {
    return result;
  }

  let guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? null;
  if (!guild) {
    try {
      guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
    } catch {
      guild = null;
    }
  }

  const resolveOne = async (id: string): Promise<void> => {
    try {
      if (guild) {
        const cachedMember = guild.members.cache.get(id);
        if (cachedMember) {
          const url = toAvatarUrl(cachedMember);
          setCachedAvatar(id, url);
          result[id] = url;
          return;
        }

        const member = await guild.members.fetch(id);
        const url = toAvatarUrl(member);
        setCachedAvatar(id, url);
        result[id] = url;
        return;
      }
    } catch {
      // fallback below
    }

    try {
      const cachedUser = client.users.cache.get(id);
      if (cachedUser) {
        const url = cachedUser.displayAvatarURL({
          extension: 'png',
          size: 128
        });
        setCachedAvatar(id, url);
        result[id] = url;
        return;
      }

      const user = await client.users.fetch(id);
      const url = user.displayAvatarURL({
        extension: 'png',
        size: 128
      });
      setCachedAvatar(id, url);
      result[id] = url;
    } catch {
      // leave unresolved
    }
  };

  for (let index = 0; index < missing.length; index += FETCH_CONCURRENCY) {
    const slice = missing.slice(index, index + FETCH_CONCURRENCY);
    await Promise.all(slice.map((id) => resolveOne(id)));
  }

  return result;
};

import { Client, Guild, GuildMember } from 'discord.js';
import { env } from '../config/env';
import { normalizeForCompare } from '../utils/normalize';

type MemberSnapshot = {
  checkedAt: number;
  exists: boolean;
  hasEmployeeRole: boolean;
};

type NameIndex = {
  checkedAt: number;
  names: Set<string>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const NAME_INDEX_TTL_MS = 5 * 60 * 1000;

const normalizeRoleName = (name: string): string => normalizeForCompare(name);

const isKnownMemberFetchError = (error: unknown): boolean => {
  const candidate = error as { code?: number | string };
  return candidate?.code === 10007 || candidate?.code === '10007';
};

const collectMemberNames = (member: GuildMember): string[] => {
  const values = [member.displayName, member.user.globalName, member.user.username, member.nickname]
    .filter(Boolean)
    .map((value) => normalizeForCompare(value as string))
    .filter(Boolean);

  return [...new Set(values)];
};

export type GuildMemberFilter = {
  guild: Guild;
  isGuildMember: (userId: string) => Promise<boolean>;
  hasEmployeeRole: (userId: string) => Promise<boolean>;
  isKnownMemberName: (name: string) => Promise<boolean>;
};

export const createGuildMemberFilter = async (client: Client): Promise<GuildMemberFilter> => {
  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);

  const memberCache = new Map<string, MemberSnapshot>();
  let nameIndex: NameIndex | null = null;

  const employeeRoleName = normalizeRoleName(env.EMPLOYEE_ROLE_NAME);

  const isSnapshotFresh = (checkedAt: number): boolean => Date.now() - checkedAt < CACHE_TTL_MS;

  const computeHasEmployeeRole = (member: GuildMember): boolean => {
    if (env.EMPLOYEE_ROLE_ID) {
      return member.roles.cache.has(env.EMPLOYEE_ROLE_ID);
    }

    return member.roles.cache.some((role) => normalizeRoleName(role.name) === employeeRoleName);
  };

  const readMember = async (userId: string): Promise<MemberSnapshot> => {
    const cached = memberCache.get(userId);
    if (cached && isSnapshotFresh(cached.checkedAt)) {
      return cached;
    }

    try {
      const member = await guild.members.fetch(userId);
      const snapshot: MemberSnapshot = {
        checkedAt: Date.now(),
        exists: true,
        hasEmployeeRole: computeHasEmployeeRole(member)
      };

      memberCache.set(userId, snapshot);
      return snapshot;
    } catch (error) {
      if (!isKnownMemberFetchError(error)) {
        console.error(`[member-filter] Failed to fetch member ${userId}`, error);
      }

      const snapshot: MemberSnapshot = {
        checkedAt: Date.now(),
        exists: false,
        hasEmployeeRole: false
      };

      memberCache.set(userId, snapshot);
      return snapshot;
    }
  };

  const ensureNameIndex = async (): Promise<NameIndex> => {
    if (nameIndex && Date.now() - nameIndex.checkedAt < NAME_INDEX_TTL_MS) {
      return nameIndex;
    }

    const members = await guild.members.fetch();
    const names = new Set<string>();

    for (const member of members.values()) {
      for (const value of collectMemberNames(member)) {
        names.add(value);
      }
    }

    nameIndex = {
      checkedAt: Date.now(),
      names
    };

    return nameIndex;
  };

  return {
    guild,
    isGuildMember: async (userId: string) => {
      const snapshot = await readMember(userId);
      return snapshot.exists;
    },
    hasEmployeeRole: async (userId: string) => {
      const snapshot = await readMember(userId);
      return snapshot.exists && snapshot.hasEmployeeRole;
    },
    isKnownMemberName: async (name: string) => {
      const normalized = normalizeForCompare(name);
      if (!normalized) {
        return false;
      }

      const index = await ensureNameIndex();
      return index.names.has(normalized);
    }
  };
};

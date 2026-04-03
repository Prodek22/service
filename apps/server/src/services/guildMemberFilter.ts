import { Client, Guild, GuildMember } from 'discord.js';
import { env } from '../config/env';
import { normalizeForCompare, normalizeWhitespace } from '../utils/normalize';

type MemberSnapshot = {
  checkedAt: number;
  exists: boolean;
  hasEmployeeRole: boolean;
  cvRank: string | null;
  rpNickname: string | null;
};

type NameIndex = {
  checkedAt: number;
  names: Set<string>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const NAME_INDEX_TTL_MS = 5 * 60 * 1000;

const normalizeRoleName = (name: string): string => normalizeForCompare(name);

type RankRoleMapping = {
  rank: string;
  roleNames: string[];
};

const CV_RANK_ROLE_PRIORITY: RankRoleMapping[] = [
  {
    rank: 'Mecanic-Senior',
    roleNames: ['mecanic-senior', 'mecanic senior']
  },
  {
    rank: 'Mecanic',
    roleNames: ['mecanic']
  },
  {
    rank: 'Mecani-Junior',
    roleNames: ['mecani-junior', 'mecani junior', 'mecanic-junior', 'mecanic junior']
  },
  {
    rank: 'Ucenic',
    roleNames: ['ucenic']
  }
];

const rankRoleIndex = CV_RANK_ROLE_PRIORITY.map((entry) => ({
  rank: entry.rank,
  normalizedRoleNames: new Set(entry.roleNames.map((name) => normalizeRoleName(name)))
}));

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

const extractRpNickname = (member: GuildMember): string | null => {
  const candidates = [member.nickname, member.displayName]
    .filter(Boolean)
    .map((value) => normalizeWhitespace(String(value)));

  for (const candidate of candidates) {
    const match = candidate.match(/^(.+?)\s*-\s*\d{2,}$/);
    if (!match) {
      continue;
    }

    const nickname = normalizeWhitespace(match[1]);
    if (nickname) {
      return nickname;
    }
  }

  return null;
};

export type GuildMemberFilter = {
  guild: Guild;
  isGuildMember: (userId: string) => Promise<boolean>;
  hasEmployeeRole: (userId: string) => Promise<boolean>;
  getCvRank: (userId: string) => Promise<string | null>;
  getRpNickname: (userId: string) => Promise<string | null>;
  listEmployeeMembers: () => Promise<Array<{ userId: string; cvRank: string | null; rpNickname: string | null }>>;
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

  const computeCvRank = (member: GuildMember): string | null => {
    const memberRoleNames = new Set(member.roles.cache.map((role) => normalizeRoleName(role.name)));

    for (const mapping of rankRoleIndex) {
      for (const roleName of mapping.normalizedRoleNames) {
        if (memberRoleNames.has(roleName)) {
          return mapping.rank;
        }
      }
    }

    return null;
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
        hasEmployeeRole: computeHasEmployeeRole(member),
        cvRank: computeCvRank(member),
        rpNickname: extractRpNickname(member)
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
        hasEmployeeRole: false,
        cvRank: null,
        rpNickname: null
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

  const listEmployeeMembers = async (): Promise<Array<{ userId: string; cvRank: string | null; rpNickname: string | null }>> => {
    const members = await guild.members.fetch();
    const now = Date.now();
    const employeeMembers: Array<{ userId: string; cvRank: string | null; rpNickname: string | null }> = [];

    for (const member of members.values()) {
      const snapshot: MemberSnapshot = {
        checkedAt: now,
        exists: true,
        hasEmployeeRole: computeHasEmployeeRole(member),
        cvRank: computeCvRank(member),
        rpNickname: extractRpNickname(member)
      };

      memberCache.set(member.id, snapshot);

      if (snapshot.hasEmployeeRole) {
        employeeMembers.push({
          userId: member.id,
          cvRank: snapshot.cvRank,
          rpNickname: snapshot.rpNickname
        });
      }
    }

    return employeeMembers;
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
    getCvRank: async (userId: string) => {
      const snapshot = await readMember(userId);
      if (!snapshot.exists) {
        return null;
      }

      return snapshot.cvRank;
    },
    getRpNickname: async (userId: string) => {
      const snapshot = await readMember(userId);
      if (!snapshot.exists) {
        return null;
      }

      return snapshot.rpNickname;
    },
    listEmployeeMembers,
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

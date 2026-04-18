import { prisma } from '../db/prisma';

type CacheState = {
  values: Set<string>;
  loadedAt: number;
};

const CACHE_TTL_MS = 30 * 1000;
let cache: CacheState | null = null;

const normalizeMessageId = (value: string): string => value.trim();

const loadActiveMessageIds = async (): Promise<Set<string>> => {
  const rows = await prisma.reactionTrackedMessage.findMany({
    where: {
      isActive: true
    },
    select: {
      messageId: true
    }
  });

  return new Set(rows.map((row) => normalizeMessageId(row.messageId)).filter(Boolean));
};

const getCachedSet = async (): Promise<Set<string>> => {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.values;
  }

  const values = await loadActiveMessageIds();
  cache = {
    values,
    loadedAt: Date.now()
  };

  return values;
};

export const invalidateReactionTrackCache = (): void => {
  cache = null;
};

export const isReactionMessageTracked = async (messageId: string, envMessageIds: string[] = []): Promise<boolean> => {
  const normalized = normalizeMessageId(messageId);
  if (!normalized) {
    return false;
  }

  if (envMessageIds.includes(normalized)) {
    return true;
  }

  const dynamicSet = await getCachedSet();
  return dynamicSet.has(normalized);
};

export const listReactionTrackedMessages = async (): Promise<
  Array<{ id: number; messageId: string; isActive: boolean; createdBy: string | null; createdAt: Date; updatedAt: Date }>
> => {
  const rows = await prisma.reactionTrackedMessage.findMany({
    orderBy: {
      createdAt: 'desc'
    }
  });

  return rows.map((row) => ({
    id: row.id,
    messageId: row.messageId,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
};

export const upsertReactionTrackedMessage = async (messageId: string, createdBy?: string): Promise<void> => {
  const normalized = normalizeMessageId(messageId);
  if (!/^\d{8,30}$/.test(normalized)) {
    throw new Error('Message ID invalid');
  }

  await prisma.reactionTrackedMessage.upsert({
    where: {
      messageId: normalized
    },
    update: {
      isActive: true,
      ...(createdBy ? { createdBy } : {})
    },
    create: {
      messageId: normalized,
      isActive: true,
      ...(createdBy ? { createdBy } : {})
    }
  });

  invalidateReactionTrackCache();
};

export const removeReactionTrackedMessage = async (messageId: string): Promise<number> => {
  const normalized = normalizeMessageId(messageId);
  const result = await prisma.reactionTrackedMessage.deleteMany({
    where: {
      messageId: normalized
    }
  });

  if (result.count > 0) {
    invalidateReactionTrackCache();
  }

  return result.count;
};


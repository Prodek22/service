import { Router } from 'express';
import { prisma } from '../db/prisma';
import { recordAuditLog } from '../services/auditLogService';
import {
  listReactionTrackedMessages,
  removeReactionTrackedMessage,
  upsertReactionTrackedMessage
} from '../services/reactionTrackService';

export const reactionRouter = Router();

reactionRouter.get('/tracked-messages', async (_req, res) => {
  const items = await listReactionTrackedMessages();
  res.json({ items });
});

reactionRouter.post('/tracked-messages', async (req, res) => {
  const messageId = String(req.body?.messageId ?? '').trim();
  if (!/^\d{8,30}$/.test(messageId)) {
    res.status(400).json({ error: 'messageId invalid.' });
    return;
  }

  const username = String(res.locals.authUser?.username ?? 'system');
  await upsertReactionTrackedMessage(messageId, username);

  await recordAuditLog({
    req,
    res,
    action: 'REACTION_TRACK_MESSAGE_UPSERT',
    entityType: 'reaction_tracked_message',
    entityId: messageId,
    metadata: {
      messageId
    }
  });

  const items = await listReactionTrackedMessages();
  res.json({ ok: true, items });
});

reactionRouter.delete('/tracked-messages/:messageId', async (req, res) => {
  const messageId = String(req.params.messageId ?? '').trim();
  if (!/^\d{8,30}$/.test(messageId)) {
    res.status(400).json({ error: 'messageId invalid.' });
    return;
  }

  const deleted = await removeReactionTrackedMessage(messageId);

  await recordAuditLog({
    req,
    res,
    action: 'REACTION_TRACK_MESSAGE_DELETE',
    entityType: 'reaction_tracked_message',
    entityId: messageId,
    metadata: {
      messageId,
      deleted
    }
  });

  const items = await listReactionTrackedMessages();
  res.json({ ok: true, deleted, items });
});

reactionRouter.get('/events', async (req, res) => {
  const page = Number.parseInt(String(req.query.page ?? '1'), 10);
  const pageSize = Number.parseInt(String(req.query.pageSize ?? '100'), 10);
  const messageId = String(req.query.messageId ?? '').trim();

  const safePage = Number.isNaN(page) ? 1 : Math.max(1, page);
  const safePageSize = Number.isNaN(pageSize) ? 100 : Math.min(Math.max(10, pageSize), 300);
  const skip = (safePage - 1) * safePageSize;

  const where = {
    ...(messageId ? { messageId } : {})
  };

  const [items, total] = await Promise.all([
    prisma.reactionEvent.findMany({
      where,
      orderBy: [{ eventAt: 'desc' }, { id: 'desc' }],
      skip,
      take: safePageSize
    }),
    prisma.reactionEvent.count({ where })
  ]);

  const userIds = [...new Set(items.map((item) => item.userId).filter(Boolean))];
  const employees =
    userIds.length > 0
      ? await prisma.employee.findMany({
          where: {
            discordUserId: {
              in: userIds
            }
          },
          select: {
            discordUserId: true,
            nickname: true,
            fullName: true,
            iban: true
          }
        })
      : [];

  const employeeByDiscordUserId = new Map(
    employees
      .filter((item) => Boolean(item.discordUserId))
      .map((item) => [
        item.discordUserId as string,
        item.nickname ?? item.fullName ?? item.iban ?? null
      ])
  );

  res.json({
    items: items.map((item) => ({
      id: item.id,
      messageId: item.messageId,
      channelId: item.channelId,
      guildId: item.guildId,
      userId: item.userId,
      userDisplayName:
        item.userDisplayName ?? employeeByDiscordUserId.get(item.userId) ?? `@${item.userId}`,
      emojiId: item.emojiId,
      emojiName: item.emojiName,
      emojiIdentifier: item.emojiIdentifier,
      action: item.action,
      eventAt: item.eventAt,
      messageUrl: `https://discord.com/channels/${item.guildId}/${item.channelId}/${item.messageId}`
    })),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize)
    }
  });
});

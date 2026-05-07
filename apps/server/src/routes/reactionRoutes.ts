import { Router } from 'express';
import { ChannelType, TextBasedChannel } from 'discord.js';
import { prisma } from '../db/prisma';
import { getDiscordClient } from '../bot/clientStore';
import { recordAuditLog } from '../services/auditLogService';
import {
  listReactionTrackedMessages,
  removeReactionTrackedMessage,
  upsertReactionTrackedMessage
} from '../services/reactionTrackService';

export const reactionRouter = Router();

const buildMessagePreview = (content: string, embeds: Array<{ title?: string | null; description?: string | null; fields?: Array<{ name?: string; value?: string }>; footer?: { text?: string | null } }>): string | null => {
  const chunks: string[] = [];

  if (content?.trim()) {
    chunks.push(content.trim());
  }

  for (const embed of embeds) {
    if (embed.title) {
      chunks.push(embed.title);
    }

    if (embed.description) {
      chunks.push(embed.description);
    }

    for (const field of embed.fields ?? []) {
      if (field.name) {
        chunks.push(field.name);
      }
      if (field.value) {
        chunks.push(field.value);
      }
    }

    if (embed.footer?.text) {
      chunks.push(embed.footer.text);
    }
  }

  const raw = chunks.join('\n').trim();
  if (!raw) {
    return null;
  }

  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
};

const hydrateMissingMessagePreviews = async (
  rows: Array<{ id: number; guildId: string; channelId: string; messageId: string; messagePreview: string | null }>
): Promise<Map<string, string>> => {
  const previewsByMessageId = new Map<string, string>();
  const missingRows = rows.filter((row) => !row.messagePreview || !row.messagePreview.trim());
  if (!missingRows.length) {
    return previewsByMessageId;
  }

  const client = getDiscordClient();
  if (!client) {
    return previewsByMessageId;
  }

  const uniqueMissing = [...new Map(missingRows.map((row) => [row.messageId, row])).values()].slice(0, 30);

  for (const row of uniqueMissing) {
    try {
      const guild = client.guilds.cache.get(row.guildId) ?? (await client.guilds.fetch(row.guildId).catch(() => null));
      if (!guild) {
        continue;
      }

      const channel = guild.channels.cache.get(row.channelId) ?? (await guild.channels.fetch(row.channelId).catch(() => null));
      if (!channel || channel.type === ChannelType.GuildForum) {
        continue;
      }

      if (!('messages' in channel)) {
        continue;
      }

      const textBased = channel as TextBasedChannel;
      const message = await textBased.messages.fetch(row.messageId).catch(() => null);
      if (!message) {
        continue;
      }

      const preview = buildMessagePreview(
        message.content ?? '',
        message.embeds.map((embed) => ({
          title: embed.title,
          description: embed.description,
          fields: embed.fields?.map((field) => ({ name: field.name, value: field.value })),
          footer: { text: embed.footer?.text ?? null }
        }))
      );

      if (!preview) {
        continue;
      }

      previewsByMessageId.set(row.messageId, preview);
      await prisma.reactionEvent.updateMany({
        where: { messageId: row.messageId },
        data: { messagePreview: preview }
      });
    } catch {
      // Ignore per-message hydrate failures.
    }
  }

  return previewsByMessageId;
};

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

  const hydratedPreviewByMessageId = await hydrateMissingMessagePreviews(items);

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
      messagePreview: item.messagePreview ?? hydratedPreviewByMessageId.get(item.messageId) ?? null,
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

reactionRouter.delete('/events/:id', async (req, res) => {
  const id = Number.parseInt(String(req.params.id ?? ''), 10);
  if (Number.isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'id invalid.' });
    return;
  }

  const existing = await prisma.reactionEvent.findUnique({
    where: { id },
    select: { id: true, messageId: true, userId: true, action: true }
  });

  if (!existing) {
    res.status(404).json({ error: 'Logul nu exista.' });
    return;
  }

  await prisma.reactionEvent.delete({
    where: { id }
  });

  await recordAuditLog({
    req,
    res,
    action: 'REACTION_EVENT_DELETE',
    entityType: 'reaction_event',
    entityId: String(id),
    metadata: {
      id: existing.id,
      messageId: existing.messageId,
      userId: existing.userId,
      eventAction: existing.action
    }
  });

  res.json({ ok: true, id });
});

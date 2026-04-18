import { prisma } from '../db/prisma';

export type DiscordReactionAuditInput = {
  action: 'ADD' | 'REMOVE';
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  emojiId: string | null;
  emojiName: string | null;
  emojiIdentifier: string | null;
  eventAt: Date;
};

export const logDiscordReactionAudit = async (input: DiscordReactionAuditInput): Promise<void> => {
  const messageUrl = `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;

  await prisma.auditLog.create({
    data: {
      actorUsername: input.userId,
      actorRole: 'DISCORD',
      action: input.action === 'ADD' ? 'DISCORD_REACTION_ADD' : 'DISCORD_REACTION_REMOVE',
      entityType: 'discord_message_reaction',
      entityId: input.messageId,
      metadataJson: JSON.stringify({
        guildId: input.guildId,
        channelId: input.channelId,
        messageId: input.messageId,
        messageUrl,
        userId: input.userId,
        emoji: {
          id: input.emojiId,
          name: input.emojiName,
          identifier: input.emojiIdentifier
        },
        eventAt: input.eventAt.toISOString()
      }),
      createdAt: input.eventAt
    }
  });
};


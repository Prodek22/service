import { ReactionEventAction } from '@prisma/client';
import { prisma } from '../db/prisma';

export type DiscordReactionAuditInput = {
  action: 'ADD' | 'REMOVE';
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  userDisplayName: string | null;
  emojiId: string | null;
  emojiName: string | null;
  emojiIdentifier: string | null;
  eventAt: Date;
};

export const logDiscordReactionAudit = async (input: DiscordReactionAuditInput): Promise<void> => {
  await prisma.reactionEvent.create({
    data: {
      action: input.action as ReactionEventAction,
      guildId: input.guildId,
      channelId: input.channelId,
      messageId: input.messageId,
      userId: input.userId,
      userDisplayName: input.userDisplayName,
      emojiId: input.emojiId,
      emojiName: input.emojiName,
      emojiIdentifier: input.emojiIdentifier,
      eventAt: input.eventAt
    }
  });
};

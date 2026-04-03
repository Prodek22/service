import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Message,
  Partials,
  TextBasedChannel
} from 'discord.js';
import { env } from '../config/env';
import { parseTimesheetMessage } from '../parsers/timesheetParser';
import { createGuildMemberFilter } from '../services/guildMemberFilter';
import { MessageInput } from '../types';
import { attachIdImageFromReply, markCvMessageDeleted, processCvMessage } from '../services/cvService';
import { markTimesheetMessageDeleted, processTimesheetMessage } from '../services/timesheetService';

const toMessageInput = (message: Message): MessageInput => ({
  id: message.id,
  channelId: message.channelId,
  content: message.content ?? '',
  authorId: message.author?.id,
  createdAt: new Date(message.createdTimestamp),
  updatedAt: message.editedTimestamp ? new Date(message.editedTimestamp) : undefined,
  referencedMessageId: message.reference?.messageId,
  attachments: [...message.attachments.values()].map((attachment) => ({
    id: attachment.id,
    url: attachment.url,
    name: attachment.name ?? undefined,
    contentType: attachment.contentType
  }))
});

const ensureMessage = async (value: Message | null): Promise<Message | null> => {
  if (!value) {
    return null;
  }

  if (value.partial) {
    try {
      return await value.fetch();
    } catch (error) {
      console.error('Failed to fetch partial message', error);
      return null;
    }
  }

  return value;
};

const processByChannel = async (
  message: Message,
  memberFilter: Awaited<ReturnType<typeof createGuildMemberFilter>>
): Promise<void> => {
  if (message.channelId === env.CV_CHANNEL_ID) {
    if (message.author?.bot) {
      return;
    }

    if (!message.author?.id || !(await memberFilter.isGuildMember(message.author.id))) {
      return;
    }

    const payload = toMessageInput(message);
    const associatedByReply = await attachIdImageFromReply(payload);

    if (!associatedByReply) {
      if (!(await memberFilter.hasEmployeeRole(message.author.id))) {
        return;
      }

      await processCvMessage(payload);
    }
  }

  if (message.channelId === env.TIMESHEET_CHANNEL_ID) {
    const parsed = parseTimesheetMessage(message.content ?? '');

    if (parsed.discordUserId && !(await memberFilter.isGuildMember(parsed.discordUserId))) {
      return;
    }

    if (parsed.actorDiscordUserId && !(await memberFilter.isGuildMember(parsed.actorDiscordUserId))) {
      return;
    }

    if (!parsed.discordUserId && parsed.targetEmployeeName) {
      const isKnownByName = await memberFilter.isKnownMemberName(parsed.targetEmployeeName);
      if (!isKnownByName) {
        return;
      }
    }

    await processTimesheetMessage(toMessageInput(message));
  }
};

const fetchMessageFromDeleteEvent = async (channel: TextBasedChannel, messageId: string): Promise<Message | null> => {
  try {
    const fetched = await channel.messages.fetch(messageId);
    return fetched;
  } catch {
    return null;
  }
};

export const startDiscordBot = async (): Promise<Client> => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });
  let memberFilter: Awaited<ReturnType<typeof createGuildMemberFilter>> | null = null;

  client.once('ready', () => {
    console.log(`Discord bot online as ${client.user?.tag}`);
  });

  client.on('messageCreate', async (message) => {
    try {
      if (message.guildId !== env.DISCORD_GUILD_ID) {
        return;
      }

      if (!memberFilter) {
        return;
      }

      await processByChannel(message, memberFilter);
    } catch (error) {
      console.error('messageCreate failed', error);
    }
  });

  client.on('messageUpdate', async (_oldMessage, newMessage) => {
    try {
      const resolved = await ensureMessage(newMessage as Message);
      if (!resolved || resolved.guildId !== env.DISCORD_GUILD_ID) {
        return;
      }

      if (!memberFilter) {
        return;
      }

      await processByChannel(resolved, memberFilter);
    } catch (error) {
      console.error('messageUpdate failed', error);
    }
  });

  client.on('messageDelete', async (message) => {
    try {
      const channel = message.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        return;
      }

      if (channel.guildId !== env.DISCORD_GUILD_ID) {
        return;
      }

      const resolved = message.partial ? await fetchMessageFromDeleteEvent(channel, message.id) : (message as Message);
      const channelId = resolved?.channelId ?? message.channelId;

      if (channelId === env.CV_CHANNEL_ID) {
        await markCvMessageDeleted(message.id);
      }

      if (channelId === env.TIMESHEET_CHANNEL_ID) {
        await markTimesheetMessageDeleted(message.id);
      }
    } catch (error) {
      console.error('messageDelete failed', error);
    }
  });

  await client.login(env.DISCORD_TOKEN);
  memberFilter = await createGuildMemberFilter(client);

  return client;
};


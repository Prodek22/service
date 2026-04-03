import { ChannelType, Client, GatewayIntentBits, Message, Partials, TextChannel } from 'discord.js';
import { env } from '../config/env';
import { parseTimesheetMessage } from '../parsers/timesheetParser';
import { MessageInput } from '../types';
import { attachIdImageFromReply, processCvMessage } from './cvService';
import { createGuildMemberFilter } from './guildMemberFilter';
import { processTimesheetMessage } from './timesheetService';

type BackfillMode = 'all' | 'latest' | 'since';
type BackfillChannel = 'cv' | 'timesheet';

type BackfillOptions = {
  mode: BackfillMode;
  latestLimitPerChannel?: number;
  channels?: BackfillChannel[];
  sinceDate?: Date;
};

export type BackfillResult = {
  cvProcessed: number;
  timesheetProcessed: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildMessageText = (message: Message): string => {
  const chunks: string[] = [];

  if (message.content?.trim()) {
    chunks.push(message.content.trim());
  }

  for (const embed of message.embeds) {
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

  return chunks.join('\n').trim();
};

const toMessageInput = (message: Message): MessageInput => ({
  id: message.id,
  channelId: message.channelId,
  content: buildMessageText(message),
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

const processCvChannelMessage = async (
  message: Message,
  memberFilter: Awaited<ReturnType<typeof createGuildMemberFilter>>
): Promise<boolean> => {
  if (message.author?.bot) {
    return false;
  }

  if (!message.author?.id || !(await memberFilter.isGuildMember(message.author.id))) {
    return false;
  }

  const payload = toMessageInput(message);
  const associated = await attachIdImageFromReply(payload);

  if (!associated && (await memberFilter.hasEmployeeRole(message.author.id))) {
    const result = await processCvMessage(payload);
    return Boolean(result);
  }

  return associated;
};

const processTimesheetChannelMessage = async (
  message: Message,
  _memberFilter: Awaited<ReturnType<typeof createGuildMemberFilter>>
): Promise<boolean> => {
  const parsed = parseTimesheetMessage(message.content ?? '');

  // Timesheet channel is treated as authoritative event stream. We avoid dropping events
  // when users left guild or when text mentions do not map to current member cache.
  if (parsed.eventType === 'UNKNOWN') {
    return false;
  }

  await processTimesheetMessage(toMessageInput(message));
  return true;
};

const processBatch = async (
  messages: Message[],
  handler: (message: Message) => Promise<boolean>
): Promise<number> => {
  let processed = 0;

  for (const message of messages) {
    const accepted = await handler(message);
    if (accepted) {
      processed += 1;
    }
  }

  return processed;
};

const backfillAll = async (
  channel: TextChannel,
  handler: (message: Message) => Promise<boolean>
): Promise<number> => {
  let before: string | undefined;
  let processed = 0;

  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });

    if (!batch.size) {
      break;
    }

    const messages = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    processed += await processBatch(messages, handler);

    before = messages[0]?.id;
    await sleep(300);
  }

  return processed;
};

const backfillLatest = async (
  channel: TextChannel,
  handler: (message: Message) => Promise<boolean>,
  limit: number
): Promise<number> => {
  const batch = await channel.messages.fetch({
    limit: Math.max(1, Math.min(limit, 100))
  });

  const messages = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return processBatch(messages, handler);
};

const backfillSince = async (
  channel: TextChannel,
  handler: (message: Message) => Promise<boolean>,
  sinceDate: Date
): Promise<number> => {
  const sinceTs = sinceDate.getTime();
  let before: string | undefined;
  let processed = 0;

  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });

    if (!batch.size) {
      break;
    }

    const messages = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const eligible = messages.filter((message) => message.createdTimestamp >= sinceTs);
    processed += await processBatch(eligible, handler);

    const oldest = messages[0];
    if (!oldest || oldest.createdTimestamp < sinceTs) {
      break;
    }

    before = oldest.id;
    await sleep(300);
  }

  return processed;
};

const includesChannel = (channels: BackfillChannel[] | undefined, target: BackfillChannel): boolean =>
  !channels || channels.includes(target);

export const runBackfill = async (options: BackfillOptions): Promise<BackfillResult> => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  try {
    await client.login(env.DISCORD_TOKEN);
    const memberFilter = await createGuildMemberFilter(client);

    const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
    const [cvRaw, timesheetRaw] = await Promise.all([
      guild.channels.fetch(env.CV_CHANNEL_ID),
      guild.channels.fetch(env.TIMESHEET_CHANNEL_ID)
    ]);

    if (!cvRaw || !timesheetRaw || cvRaw.type !== ChannelType.GuildText || timesheetRaw.type !== ChannelType.GuildText) {
      throw new Error('Canalele configurate trebuie sa fie GuildText.');
    }

    const cvHandler = (message: Message) => processCvChannelMessage(message, memberFilter);
    const timesheetHandler = (message: Message) => processTimesheetChannelMessage(message, memberFilter);

    const latestLimit = options.latestLimitPerChannel ?? 100;
    const channels = options.channels;
    const sinceDate = options.sinceDate;

    let cvProcessed = 0;
    if (includesChannel(channels, 'cv')) {
      if (options.mode === 'all') {
        cvProcessed = await backfillAll(cvRaw, cvHandler);
      } else if (options.mode === 'since' && sinceDate) {
        cvProcessed = await backfillSince(cvRaw, cvHandler, sinceDate);
      } else {
        cvProcessed = await backfillLatest(cvRaw, cvHandler, latestLimit);
      }
    }

    let timesheetProcessed = 0;
    if (includesChannel(channels, 'timesheet')) {
      if (options.mode === 'all') {
        timesheetProcessed = await backfillAll(timesheetRaw, timesheetHandler);
      } else if (options.mode === 'since' && sinceDate) {
        timesheetProcessed = await backfillSince(timesheetRaw, timesheetHandler, sinceDate);
      } else {
        timesheetProcessed = await backfillLatest(timesheetRaw, timesheetHandler, latestLimit);
      }
    }

    return {
      cvProcessed,
      timesheetProcessed
    };
  } finally {
    client.destroy();
  }
};

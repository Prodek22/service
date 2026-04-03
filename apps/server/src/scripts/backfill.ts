import { ChannelType, Client, GatewayIntentBits, Message, Partials, TextChannel } from 'discord.js';
import { env } from '../config/env';
import { parseTimesheetMessage } from '../parsers/timesheetParser';
import { attachIdImageFromReply, processCvMessage } from '../services/cvService';
import { createGuildMemberFilter } from '../services/guildMemberFilter';
import { processTimesheetMessage } from '../services/timesheetService';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toMessageInput = (message: Message) => ({
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

const processCvChannelMessage = async (
  message: Message,
  memberFilter: Awaited<ReturnType<typeof createGuildMemberFilter>>
) => {
  if (message.author?.bot) {
    return;
  }

  if (!message.author?.id || !(await memberFilter.isGuildMember(message.author.id))) {
    return;
  }

  const payload = toMessageInput(message);
  const associated = await attachIdImageFromReply(payload);

  if (!associated && (await memberFilter.hasEmployeeRole(message.author.id))) {
    await processCvMessage(payload);
  }
};

const processTimesheetChannelMessage = async (
  message: Message,
  memberFilter: Awaited<ReturnType<typeof createGuildMemberFilter>>
) => {
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
};

const backfillChannel = async (
  channel: TextChannel,
  handler: (message: Message) => Promise<void>
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

    // Oldest -> newest keeps week-cycle creation and edits deterministic while replaying history.
    for (const message of messages) {
      await handler(message);
      processed += 1;
    }

    before = messages[0]?.id;
    console.log(`[backfill] ${channel.id}: processed ${processed}`);

    await sleep(350);
  }

  return processed;
};

const run = async () => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

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

  console.log('[backfill] Starting CV channel...');
  const cvCount = await backfillChannel(cvRaw, (message) => processCvChannelMessage(message, memberFilter));

  console.log('[backfill] Starting timesheet channel...');
  const timesheetCount = await backfillChannel(timesheetRaw, (message) =>
    processTimesheetChannelMessage(message, memberFilter)
  );

  console.log(`[backfill] Completed. CV messages: ${cvCount}, timesheet messages: ${timesheetCount}`);

  client.destroy();
  process.exit(0);
};

run().catch((error) => {
  console.error('[backfill] failed', error);
  process.exit(1);
});


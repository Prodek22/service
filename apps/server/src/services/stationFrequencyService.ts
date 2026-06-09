import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  GuildMember,
  Interaction,
  PermissionFlagsBits,
  TextChannel
} from 'discord.js';
import { randomInt } from 'node:crypto';
import { env } from '../config/env';

const STATION_NEW_ID = 'station-frequency:new';
const ICON_SATELLITE = '\u{1F4E1}';
const ICON_DICE = '\u{1F3B2}';
const STATION_PANEL_MARKER = '||station-frequency-panel||';
const LEGACY_STATION_PANEL_TITLE = '**Frecventa statiei**';

const isStationFrequencyConfigured = (): boolean =>
  env.STATION_FREQUENCY_ENABLED && env.STATION_FREQUENCY_CHANNEL_IDS.length > 0;

const getGuildTextChannel = async (client: Client, channelId: string): Promise<TextChannel | null> => {
  if (!channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return null;
  }

  return channel;
};

const generateStationFrequency = (): string => {
  const prefix = randomInt(100, 1000);
  const suffix = randomInt(0, 1000);

  return `${prefix}.${String(suffix).padStart(3, '0')}`;
};

const extractCurrentFrequency = (content: string): string | null => {
  const matches = [...content.matchAll(/`(\d{3}\.\d{3})`/g)];
  const lastMatch = matches.at(-1);

  return lastMatch?.[1] ?? null;
};

const buildStationButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(STATION_NEW_ID)
      .setLabel('Statie noua')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(ICON_DICE)
  );

const buildStationPanelContent = (newFrequency: string, oldFrequency: string | null): string => {
  const roleMentions = env.STATION_FREQUENCY_ROLE_IDS.map((roleId) => `<@&${roleId}>`).join(' ');

  return [
    roleMentions,
    roleMentions ? '' : null,
    `${ICON_SATELLITE} **Statia veche**`,
    oldFrequency ? `\`${oldFrequency}\`` : '-',
    '',
    `${ICON_SATELLITE} **Statia noua**`,
    `\`${newFrequency}\``,
    '',
    STATION_PANEL_MARKER
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

const findStationPanelMessage = async (channel: TextChannel) => {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) {
    return null;
  }

  return (
    messages.find(
      (message) =>
        message.author.id === channel.client.user?.id &&
        (message.content.includes(STATION_PANEL_MARKER) || message.content.includes(LEGACY_STATION_PANEL_TITLE))
    ) ?? null
  );
};

const sendStationPanel = async (channel: TextChannel, oldFrequency: string | null = null): Promise<void> => {
  await channel.send({
    content: buildStationPanelContent(generateStationFrequency(), oldFrequency),
    components: [buildStationButtons()],
    allowedMentions: {
      roles: env.STATION_FREQUENCY_ROLE_IDS
    }
  });
};

export const ensureStationFrequencyPanel = async (client: Client): Promise<void> => {
  if (!env.STATION_FREQUENCY_ENABLED) {
    console.log('[station-frequency] disabled');
    return;
  }

  if (!isStationFrequencyConfigured()) {
    console.warn('[station-frequency] enabled but channel id is missing');
    return;
  }

  for (const channelId of env.STATION_FREQUENCY_CHANNEL_IDS) {
    const channel = await getGuildTextChannel(client, channelId);
    if (!channel) {
      console.warn(`[station-frequency] channel not found: ${channelId}`);
      continue;
    }

    const existingMessage = await findStationPanelMessage(channel);
    if (existingMessage) {
      continue;
    }

    await sendStationPanel(channel);
    console.log(`[station-frequency] panel created in channel ${channelId}`);
  }
};

const hasStationAccess = (member: GuildMember): boolean => {
  const allowedUserIds = env.STATION_FREQUENCY_MANAGER_USER_IDS;
  const allowedRoleIds = env.STATION_FREQUENCY_MANAGER_ROLE_IDS;

  if (allowedUserIds.length === 0 && allowedRoleIds.length === 0) {
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  }

  if (allowedUserIds.includes(member.id)) {
    return true;
  }

  return allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
};

const getInteractionMember = async (interaction: ButtonInteraction): Promise<GuildMember | null> => {
  if (!interaction.guild) {
    return null;
  }

  const cached = interaction.guild.members.cache.get(interaction.user.id);
  if (cached) {
    return cached;
  }

  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
};

export const handleStationFrequencyInteraction = async (interaction: Interaction): Promise<boolean> => {
  if (!interaction.isButton() || interaction.customId !== STATION_NEW_ID) {
    return false;
  }

  if (!isStationFrequencyConfigured()) {
    await interaction.reply({
      content: 'Panoul pentru frecventa statiei nu este configurat inca.',
      ephemeral: true
    });
    return true;
  }

  const member = await getInteractionMember(interaction);
  if (!member || !hasStationAccess(member)) {
    await interaction.reply({
      content: 'Nu ai acces sa generezi o statie noua.',
      ephemeral: true
    });
    return true;
  }

  if (!env.STATION_FREQUENCY_CHANNEL_IDS.includes(interaction.channelId)) {
    await interaction.reply({
      content: 'Acest buton nu apartine unui canal configurat pentru frecventa statiei.',
      ephemeral: true
    });
    return true;
  }

  const channel = await getGuildTextChannel(interaction.client, interaction.channelId);
  if (!channel) {
    await interaction.reply({
      content: 'Canalul pentru frecventa statiei nu a fost gasit.',
      ephemeral: true
    });
    return true;
  }

  await interaction.deferUpdate();
  const oldFrequency = extractCurrentFrequency(interaction.message.content);
  await interaction.message.delete().catch(() => undefined);
  await sendStationPanel(channel, oldFrequency);

  return true;
};

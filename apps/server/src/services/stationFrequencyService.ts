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
const ICON_RADIO = '\u{1F4FB}';
const ICON_SATELLITE = '\u{1F4E1}';
const ICON_DICE = '\u{1F3B2}';
const STATION_PANEL_TITLE = `${ICON_RADIO} **Frecventa statiei**`;

const isStationFrequencyConfigured = (): boolean =>
  env.STATION_FREQUENCY_ENABLED && Boolean(env.STATION_FREQUENCY_CHANNEL_ID);

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

const buildStationButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(STATION_NEW_ID)
      .setLabel('Statie noua')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(ICON_DICE)
  );

const buildStationPanelContent = (frequency: string): string => {
  const roleMentions = env.STATION_FREQUENCY_ROLE_IDS.map((roleId) => `<@&${roleId}>`).join(' ');

  return [
    roleMentions,
    roleMentions ? '' : null,
    STATION_PANEL_TITLE,
    '',
    `${ICON_SATELLITE} **Statia curenta**`,
    `\`${frequency}\``,
    '',
    'Apasa **Statie noua** pentru a genera o frecventa noua.'
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
      (message) => message.author.id === channel.client.user?.id && message.content.includes(STATION_PANEL_TITLE)
    ) ?? null
  );
};

const sendStationPanel = async (channel: TextChannel): Promise<void> => {
  await channel.send({
    content: buildStationPanelContent(generateStationFrequency()),
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

  const channel = await getGuildTextChannel(client, env.STATION_FREQUENCY_CHANNEL_ID);
  if (!channel) {
    console.warn('[station-frequency] channel not found');
    return;
  }

  const existingMessage = await findStationPanelMessage(channel);
  if (existingMessage) {
    return;
  }

  await sendStationPanel(channel);
  console.log('[station-frequency] panel created');
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

  const channel = await getGuildTextChannel(interaction.client, env.STATION_FREQUENCY_CHANNEL_ID);
  if (!channel) {
    await interaction.reply({
      content: 'Canalul pentru frecventa statiei nu a fost gasit.',
      ephemeral: true
    });
    return true;
  }

  await interaction.deferUpdate();
  await interaction.message.delete().catch(() => undefined);
  await sendStationPanel(channel);

  return true;
};

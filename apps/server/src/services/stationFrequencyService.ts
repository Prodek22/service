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
const LEGACY_STATION_PANEL_TITLE = '**Frecventa statiei**';
const stationChannelLocks = new Set<string>();

type StationPanelConfig = {
  channelId: string;
  roleIds: string[];
  managerRoleIds: string[];
  managerUserIds: string[];
};

const getStationPanelConfigs = (): StationPanelConfig[] => {
  const explicitConfigs: StationPanelConfig[] = [
    {
      channelId: env.STATION_FREQUENCY_BIG_CHANNEL_ID,
      roleIds: env.STATION_FREQUENCY_BIG_ROLE_IDS,
      managerRoleIds: env.STATION_FREQUENCY_BIG_MANAGER_ROLE_IDS,
      managerUserIds: env.STATION_FREQUENCY_BIG_MANAGER_USER_IDS
    },
    {
      channelId: env.STATION_FREQUENCY_SMALL_CHANNEL_ID,
      roleIds: env.STATION_FREQUENCY_SMALL_ROLE_IDS,
      managerRoleIds: env.STATION_FREQUENCY_SMALL_MANAGER_ROLE_IDS,
      managerUserIds: env.STATION_FREQUENCY_SMALL_MANAGER_USER_IDS
    }
  ].filter((config) => Boolean(config.channelId));

  const explicitChannelIds = new Set(explicitConfigs.map((config) => config.channelId));
  const legacyConfigs = env.STATION_FREQUENCY_CHANNEL_IDS
    .filter((channelId) => !explicitChannelIds.has(channelId))
    .map((channelId) => ({
      channelId,
      roleIds: env.STATION_FREQUENCY_ROLE_IDS,
      managerRoleIds: env.STATION_FREQUENCY_MANAGER_ROLE_IDS,
      managerUserIds: env.STATION_FREQUENCY_MANAGER_USER_IDS
    }));

  return [...explicitConfigs, ...legacyConfigs];
};

const isStationFrequencyConfigured = (): boolean =>
  env.STATION_FREQUENCY_ENABLED && getStationPanelConfigs().length > 0;

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

const buildStationPanelContent = (
  newFrequency: string,
  oldFrequency: string | null,
  config: StationPanelConfig
): string => {
  const roleMentions = config.roleIds.map((roleId) => `<@&${roleId}>`).join(' ');

  return [
    roleMentions,
    roleMentions ? '' : null,
    `${ICON_SATELLITE} **Statia veche**`,
    oldFrequency ? `\`${oldFrequency}\`` : '-',
    '',
    `${ICON_SATELLITE} **Statia noua**`,
    `\`${newFrequency}\``
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
      (message) => {
        if (message.author.id !== channel.client.user?.id) {
          return false;
        }

        const hasStationButton = message.components.some((row) => {
          const components = 'components' in row && Array.isArray(row.components) ? row.components : [];
          return components.some((component: unknown) => {
            if (!component || typeof component !== 'object' || !('customId' in component)) {
              return false;
            }

            return (component as { customId?: string }).customId === STATION_NEW_ID;
          });
        });

        return hasStationButton || message.content.includes(LEGACY_STATION_PANEL_TITLE);
      }
    ) ?? null
  );
};

const sendStationPanel = async (
  channel: TextChannel,
  config: StationPanelConfig,
  oldFrequency: string | null = null
): Promise<void> => {
  await channel.send({
    content: buildStationPanelContent(generateStationFrequency(), oldFrequency, config),
    components: [buildStationButtons()],
    allowedMentions: {
      roles: config.roleIds
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

  for (const config of getStationPanelConfigs()) {
    const channel = await getGuildTextChannel(client, config.channelId);
    if (!channel) {
      console.warn(`[station-frequency] channel not found: ${config.channelId}`);
      continue;
    }

    const existingMessage = await findStationPanelMessage(channel);
    if (existingMessage) {
      continue;
    }

    await sendStationPanel(channel, config);
    console.log(`[station-frequency] panel created in channel ${config.channelId}`);
  }
};

const hasStationAccess = (member: GuildMember, config: StationPanelConfig): boolean => {
  const allowedUserIds = config.managerUserIds;
  const allowedRoleIds = config.managerRoleIds;

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

  const config = getStationPanelConfigs().find((item) => item.channelId === interaction.channelId);
  if (!config) {
    await interaction.reply({
      content: 'Acest buton nu apartine unui canal configurat pentru frecventa statiei.',
      ephemeral: true
    });
    return true;
  }

  const member = await getInteractionMember(interaction);
  if (!member || !hasStationAccess(member, config)) {
    await interaction.reply({
      content: 'Nu ai acces sa generezi o statie noua.',
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

  if (stationChannelLocks.has(interaction.channelId)) {
    await interaction.reply({
      content: 'Se genereaza deja o statie noua, incearca peste cateva secunde.',
      ephemeral: true
    });
    return true;
  }

  stationChannelLocks.add(interaction.channelId);
  try {
    await interaction.deferUpdate();
    const oldFrequency = extractCurrentFrequency(interaction.message.content);
    await interaction.message.delete().catch(() => undefined);
    await sendStationPanel(channel, config, oldFrequency);
  } finally {
    stationChannelLocks.delete(interaction.channelId);
  }

  return true;
};

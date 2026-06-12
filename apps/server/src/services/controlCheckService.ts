import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  GuildMember,
  Interaction,
  TextChannel
} from 'discord.js';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

const CONTROL_CHECK_ID = 'control-check:record';
const CONTROL_CHECK_PANEL_TITLE = '\u{1F4CB} **Control service**';
const ICON_CHECK = '\u{2705}';

const isControlCheckConfigured = (): boolean => env.CONTROL_CHECK_ENABLED && Boolean(env.CONTROL_CHECK_CHANNEL_ID);

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

const getMemberDisplayName = (member: GuildMember): string =>
  member.displayName || member.user.globalName || member.user.displayName || member.user.username;

const buildControlCheckButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CONTROL_CHECK_ID)
      .setLabel('Control facut')
      .setStyle(ButtonStyle.Success)
      .setEmoji(ICON_CHECK)
  );

const findControlCheckPanelMessage = async (channel: TextChannel) => {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) {
    return null;
  }

  return (
    messages.find((message) => {
      if (message.author.id !== channel.client.user?.id) {
        return false;
      }

      const hasControlButton = message.components.some((row) => {
        const components = 'components' in row && Array.isArray(row.components) ? row.components : [];
        return components.some((component: unknown) => {
          if (!component || typeof component !== 'object' || !('customId' in component)) {
            return false;
          }

          return (component as { customId?: string }).customId === CONTROL_CHECK_ID;
        });
      });

      return hasControlButton || message.content.includes(CONTROL_CHECK_PANEL_TITLE);
    }) ?? null
  );
};

const sendControlCheckPanel = async (channel: TextChannel): Promise<void> => {
  await channel.send({
    content: [CONTROL_CHECK_PANEL_TITLE, '', 'Apasa butonul cand controlul a fost facut.'].join('\n'),
    components: [buildControlCheckButtons()],
    allowedMentions: {
      parse: []
    }
  });
};

export const ensureControlCheckPanel = async (client: Client): Promise<void> => {
  if (!env.CONTROL_CHECK_ENABLED) {
    console.log('[control-check] disabled');
    return;
  }

  if (!isControlCheckConfigured()) {
    console.warn('[control-check] enabled but channel id is missing');
    return;
  }

  const channel = await getGuildTextChannel(client, env.CONTROL_CHECK_CHANNEL_ID);
  if (!channel) {
    console.warn(`[control-check] channel not found: ${env.CONTROL_CHECK_CHANNEL_ID}`);
    return;
  }

  const existingMessage = await findControlCheckPanelMessage(channel);
  if (existingMessage) {
    return;
  }

  await sendControlCheckPanel(channel);
  console.log(`[control-check] panel created in channel ${env.CONTROL_CHECK_CHANNEL_ID}`);
};

const hasControlCheckAccess = (member: GuildMember): boolean => {
  const allowedUserIds = env.CONTROL_CHECK_MANAGER_USER_IDS;
  const allowedRoleIds = env.CONTROL_CHECK_MANAGER_ROLE_IDS;

  if (allowedUserIds.length === 0 && allowedRoleIds.length === 0) {
    return true;
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

export const handleControlCheckInteraction = async (interaction: Interaction): Promise<boolean> => {
  if (!interaction.isButton() || interaction.customId !== CONTROL_CHECK_ID) {
    return false;
  }

  if (!isControlCheckConfigured()) {
    await interaction.reply({
      content: 'Panoul pentru control service nu este configurat inca.',
      ephemeral: true
    });
    return true;
  }

  if (interaction.channelId !== env.CONTROL_CHECK_CHANNEL_ID) {
    await interaction.reply({
      content: 'Acest buton nu apartine canalului configurat pentru control service.',
      ephemeral: true
    });
    return true;
  }

  const member = await getInteractionMember(interaction);
  if (!member || !hasControlCheckAccess(member)) {
    await interaction.reply({
      content: 'Nu ai acces sa inregistrezi controlul.',
      ephemeral: true
    });
    return true;
  }

  const checkedAt = new Date();
  await prisma.controlCheckLog.create({
    data: {
      channelId: interaction.channelId,
      discordUserId: member.id,
      userDisplayName: getMemberDisplayName(member),
      checkedAt
    }
  });

  await interaction.reply({
    content: 'Controlul a fost inregistrat si va aparea pe site.',
    ephemeral: true
  });

  return true;
};

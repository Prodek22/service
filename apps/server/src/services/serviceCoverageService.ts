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
import { TimeEventType } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

const COVERAGE_CLOCK_IN_ID = 'service-coverage:clock-in';
const COVERAGE_CLOCK_OUT_ID = 'service-coverage:clock-out';
const COVERAGE_CLEAR_ID = 'service-coverage:clear';
const ICON_CLIPBOARD = '\u{1F4CB}';
const ICON_GREEN_CIRCLE = '\u{1F7E2}';
const ICON_NUMBERS = '\u{1F522}';
const ICON_CHECK = '\u{2705}';
const ICON_CROSS = '\u{274C}';
const ICON_BROOM = '\u{1F9F9}';
const ICON_WARNING = '\u{26A0}\u{FE0F}';
const COVERAGE_PANEL_TITLE = `${ICON_CLIPBOARD} **Pontaj Extra Service**`;

let coverageTimer: NodeJS.Timeout | null = null;
let lastRunMinuteKey: string | null = null;
let lastAutoCloseMinuteKey: string | null = null;
let lastAlertAt = 0;

const parseTimeToMinutes = (value: string, fallback: number): number => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }

  return hours * 60 + minutes;
};

const getLocalMinuteOfDay = (date: Date): number => date.getHours() * 60 + date.getMinutes();

const getLocalMinuteKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const getCoverageTimes = () => ({
  precheck: parseTimeToMinutes(env.SERVICE_COVERAGE_PRECHECK_TIME, 17 * 60 + 55),
  start: parseTimeToMinutes(env.SERVICE_COVERAGE_START_TIME, 18 * 60),
  end: parseTimeToMinutes(env.SERVICE_COVERAGE_END_TIME, 23 * 60)
});

const isCoverageConfigured = (): boolean =>
  env.SERVICE_COVERAGE_ENABLED &&
  Boolean(env.SERVICE_COVERAGE_EXTRA_CHANNEL_ID) &&
  Boolean(env.SERVICE_COVERAGE_HELP_CHANNEL_ID);

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

const buildCoveragePanelContent = async (): Promise<string> => {
  const activeSessions = await prisma.serviceCoverageSession.findMany({
    where: {
      endedAt: null
    },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }]
  });

  const list =
    activeSessions.length > 0
      ? activeSessions
          .map((session, index) => {
            const label = session.displayName ? ` - ${session.displayName}` : '';
            return `${index + 1}. <@${session.discordUserId}>${label}`;
          })
          .join('\n')
      : '_Nimeni pe acoperire service._';

  return [
    COVERAGE_PANEL_TITLE,
    '',
    `${ICON_GREEN_CIRCLE} **Lista**`,
    list,
    '',
    `${ICON_NUMBERS} **Total**`,
    String(activeSessions.length)
  ].join('\n');
};

const buildCoverageButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(COVERAGE_CLOCK_IN_ID)
      .setLabel('Intrare')
      .setStyle(ButtonStyle.Success)
      .setEmoji(ICON_CHECK),
    new ButtonBuilder()
      .setCustomId(COVERAGE_CLOCK_OUT_ID)
      .setLabel('Iesire')
      .setStyle(ButtonStyle.Danger)
      .setEmoji(ICON_CROSS),
    new ButtonBuilder()
      .setCustomId(COVERAGE_CLEAR_ID)
      .setLabel('Sterge lista')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(ICON_BROOM)
  );

const findCoveragePanelMessage = async (channel: TextChannel) => {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) {
    return null;
  }

  return (
    messages.find(
      (message) => message.author.id === channel.client.user?.id && message.content.includes(COVERAGE_PANEL_TITLE)
    ) ?? null
  );
};

export const refreshServiceCoveragePanel = async (client: Client): Promise<void> => {
  if (!isCoverageConfigured()) {
    return;
  }

  const channel = await getGuildTextChannel(client, env.SERVICE_COVERAGE_EXTRA_CHANNEL_ID);
  if (!channel) {
    console.warn('[service-coverage] extra coverage channel not found');
    return;
  }

  const payload = {
    content: await buildCoveragePanelContent(),
    components: [buildCoverageButtons()],
    allowedMentions: {
      parse: [] as []
    }
  };

  const existingMessage = await findCoveragePanelMessage(channel);
  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
};

const hasCoverageAccess = (member: GuildMember): boolean => {
  const allowedUserIds = env.SERVICE_COVERAGE_MANAGER_USER_IDS;
  const allowedRoleIds = env.SERVICE_COVERAGE_MANAGER_ROLE_IDS;

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

const startCoverageSession = async (member: GuildMember): Promise<'created' | 'already-active'> => {
  const activeSession = await prisma.serviceCoverageSession.findFirst({
    where: {
      discordUserId: member.id,
      endedAt: null
    }
  });

  if (activeSession) {
    return 'already-active';
  }

  await prisma.serviceCoverageSession.create({
    data: {
      discordUserId: member.id,
      displayName: getMemberDisplayName(member),
      startedBy: member.id
    }
  });

  return 'created';
};

const stopCoverageSession = async (member: GuildMember): Promise<number> => {
  const result = await prisma.serviceCoverageSession.updateMany({
    where: {
      discordUserId: member.id,
      endedAt: null
    },
    data: {
      endedAt: new Date(),
      endedBy: member.id
    }
  });

  return result.count;
};

const clearCoverageSessions = async (endedBy: string): Promise<number> => {
  const result = await prisma.serviceCoverageSession.updateMany({
    where: {
      endedAt: null
    },
    data: {
      endedAt: new Date(),
      endedBy
    }
  });

  return result.count;
};

export const handleServiceCoverageInteraction = async (interaction: Interaction): Promise<boolean> => {
  if (!interaction.isButton()) {
    return false;
  }

  if (
    interaction.customId !== COVERAGE_CLOCK_IN_ID &&
    interaction.customId !== COVERAGE_CLOCK_OUT_ID &&
    interaction.customId !== COVERAGE_CLEAR_ID
  ) {
    return false;
  }

  if (!isCoverageConfigured()) {
    await interaction.reply({
      content: 'Pontajul extra nu este configurat inca.',
      ephemeral: true
    });
    return true;
  }

  const member = await getInteractionMember(interaction);
  if (!member || !hasCoverageAccess(member)) {
    await interaction.reply({
      content: 'Nu ai acces la pontajul extra pentru acoperire service.',
      ephemeral: true
    });
    return true;
  }

  if (interaction.customId === COVERAGE_CLOCK_IN_ID) {
    const result = await startCoverageSession(member);
    await refreshServiceCoveragePanel(interaction.client);
    await interaction.reply({
      content: result === 'created' ? 'Ai intrat pe acoperire service.' : 'Esti deja pe acoperire service.',
      ephemeral: true
    });
    return true;
  }

  if (interaction.customId === COVERAGE_CLOCK_OUT_ID) {
    const closed = await stopCoverageSession(member);
    await refreshServiceCoveragePanel(interaction.client);
    await interaction.reply({
      content: closed > 0 ? 'Ai iesit de pe acoperire service.' : 'Nu erai pe acoperire service.',
      ephemeral: true
    });
    return true;
  }

  const cleared = await clearCoverageSessions(member.id);
  await refreshServiceCoveragePanel(interaction.client);
  await interaction.reply({
    content: `Lista de acoperire a fost stearsa. Sesiuni inchise: ${cleared}.`,
    ephemeral: true
  });
  return true;
};

const getActiveMechanicTimesheetCount = async (at: Date): Promise<number> => {
  const cycle = await prisma.weekCycle.findFirst({
    where: {
      serviceCode: 'service',
      startedAt: {
        lte: at
      },
      OR: [
        {
          endedAt: null
        },
        {
          endedAt: {
            gt: at
          }
        }
      ]
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }]
  });

  const events = await prisma.timeEvent.findMany({
    where: {
      serviceCode: 'service',
      isDeleted: false,
      eventAt: {
        ...(cycle ? { gte: cycle.startedAt } : {}),
        lte: at
      },
      eventType: {
        in: [TimeEventType.CLOCK_IN, TimeEventType.CLOCK_OUT]
      }
    },
    select: {
      targetEmployeeId: true,
      discordUserId: true,
      targetEmployeeName: true,
      eventType: true
    },
    orderBy: {
      eventAt: 'asc'
    }
  });

  const openCounts = new Map<string, number>();

  for (const event of events) {
    const key =
      event.targetEmployeeId != null
        ? `employee:${event.targetEmployeeId}`
        : event.discordUserId
          ? `discord:${event.discordUserId}`
          : event.targetEmployeeName
            ? `name:${event.targetEmployeeName.trim().toLowerCase()}`
            : null;

    if (!key) {
      continue;
    }

    const current = openCounts.get(key) ?? 0;
    if (event.eventType === TimeEventType.CLOCK_IN) {
      openCounts.set(key, current + 1);
      continue;
    }

    if (current > 1) {
      openCounts.set(key, current - 1);
    } else {
      openCounts.delete(key);
    }
  }

  return openCounts.size;
};

const getActiveManagerCoverageCount = async (): Promise<number> =>
  prisma.serviceCoverageSession.count({
    where: {
      endedAt: null
    }
  });

const sendCoverageAlert = async (
  client: Client,
  reason: 'precheck' | 'empty',
  activeMechanics: number,
  activeManagers: number
): Promise<void> => {
  const now = Date.now();
  const cooldownMs = env.SERVICE_COVERAGE_ALERT_COOLDOWN_MINUTES * 60 * 1000;
  if (lastAlertAt && now - lastAlertAt < cooldownMs) {
    return;
  }

  const channel = await getGuildTextChannel(client, env.SERVICE_COVERAGE_HELP_CHANNEL_ID);
  if (!channel) {
    console.warn('[service-coverage] help channel not found');
    return;
  }

  const roleMentions = env.SERVICE_COVERAGE_HELP_ROLE_IDS.map((roleId) => `<@&${roleId}>`).join(' ');
  const headline =
    reason === 'precheck'
      ? `${ICON_WARNING} **E nevoie de ajutor la service pentru ora 18:00.**`
      : `${ICON_WARNING} **Service-ul este gol. Este nevoie de ajutor.**`;

  await channel.send({
    content: [
      roleMentions,
      roleMentions ? '' : null,
      headline,
      `Mecanici pe pontaj: **${activeMechanics}**`,
      `Manageri pe acoperire: **${activeManagers}**`,
      '',
      'Cine poate ajuta, intra pe pontaj sau pe **Acoperire Service**.'
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    allowedMentions: {
      roles: env.SERVICE_COVERAGE_HELP_ROLE_IDS
    }
  });

  lastAlertAt = now;
};

const autoCloseCoverageAtEnd = async (client: Client, at: Date): Promise<void> => {
  const minuteKey = getLocalMinuteKey(at);
  if (lastAutoCloseMinuteKey === minuteKey) {
    return;
  }

  lastAutoCloseMinuteKey = minuteKey;
  const closed = await clearCoverageSessions('system:auto-end');
  if (closed > 0) {
    await refreshServiceCoveragePanel(client);
    console.log(`[service-coverage] auto-closed ${closed} manager coverage sessions`);
  }
};

const runCoverageCheck = async (client: Client, at = new Date()): Promise<void> => {
  if (!isCoverageConfigured()) {
    return;
  }

  const minute = getLocalMinuteOfDay(at);
  const minuteKey = getLocalMinuteKey(at);
  const { precheck, start, end } = getCoverageTimes();

  if (minute === end) {
    await autoCloseCoverageAtEnd(client, at);
    return;
  }

  const isPrecheck = minute === precheck;
  const isRecurring =
    minute >= start &&
    minute < end &&
    (minute - start) % env.SERVICE_COVERAGE_CHECK_INTERVAL_MINUTES === 0;

  if (!isPrecheck && !isRecurring) {
    return;
  }

  if (lastRunMinuteKey === minuteKey) {
    return;
  }

  lastRunMinuteKey = minuteKey;

  const [activeMechanics, activeManagers] = await Promise.all([
    getActiveMechanicTimesheetCount(at),
    getActiveManagerCoverageCount()
  ]);

  if (isPrecheck && activeMechanics < env.SERVICE_COVERAGE_PRECHECK_MIN_MECHANICS) {
    await sendCoverageAlert(client, 'precheck', activeMechanics, activeManagers);
    return;
  }

  if (isRecurring && activeMechanics + activeManagers < 1) {
    await sendCoverageAlert(client, 'empty', activeMechanics, activeManagers);
  }
};

export const startServiceCoverageSystem = async (client: Client): Promise<void> => {
  if (!env.SERVICE_COVERAGE_ENABLED) {
    console.log('[service-coverage] disabled');
    return;
  }

  if (!isCoverageConfigured()) {
    console.warn('[service-coverage] enabled but channel ids are missing');
    return;
  }

  await refreshServiceCoveragePanel(client);

  if (coverageTimer) {
    clearInterval(coverageTimer);
  }

  coverageTimer = setInterval(() => {
    void runCoverageCheck(client).catch((error) => {
      console.error('[service-coverage] check failed', error);
    });
  }, 60 * 1000);

  console.log(
    `[service-coverage] enabled: precheck=${env.SERVICE_COVERAGE_PRECHECK_TIME}, window=${env.SERVICE_COVERAGE_START_TIME}-${env.SERVICE_COVERAGE_END_TIME}, interval=${env.SERVICE_COVERAGE_CHECK_INTERVAL_MINUTES}m`
  );
};

export const stopServiceCoverageSystem = (): void => {
  if (!coverageTimer) {
    return;
  }

  clearInterval(coverageTimer);
  coverageTimer = null;
};

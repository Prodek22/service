require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits
} = require('discord.js');
const { loadState, saveState } = require('./state');

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
  zoneChannelId: process.env.ZONE_CHANNEL_ID,
  zoneName: process.env.ZONE_NAME || 'Paznic Zona',
  panelMessageId: process.env.ZONE_PANEL_MESSAGE_ID || null,
  adminRoleIds: (process.env.ZONE_ADMIN_ROLE_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
};

for (const [key, value] of Object.entries({
  DISCORD_TOKEN: config.token,
  DISCORD_GUILD_ID: config.guildId,
  ZONE_CHANNEL_ID: config.zoneChannelId
})) {
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const state = loadState();
if (config.panelMessageId && !state.panel.messageId) {
  state.panel.messageId = config.panelMessageId;
}
if (!state.panel.channelId) {
  state.panel.channelId = config.zoneChannelId;
}
saveState(state);

const ids = {
  enter: 'zone_enter',
  exit: 'zone_exit',
  clear: 'zone_clear'
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const formatDuration = (seconds) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const nowTs = () => Date.now();

const buildComponents = () => {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ids.enter).setLabel('Intrare').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(ids.exit).setLabel('Ieșire').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ids.clear).setLabel('Șterge listă').setStyle(ButtonStyle.Secondary)
  );
  return [row];
};

const activeList = () =>
  Object.entries(state.active)
    .map(([userId, row]) => ({ userId, ...row }))
    .sort((a, b) => a.enteredAt - b.enteredAt);

const buildEmbed = () => {
  const active = activeList();
  const lines = active.length
    ? active.map((row, index) => {
        const elapsedSec = Math.floor((nowTs() - row.enteredAt) / 1000);
        return `${index + 1}. <@${row.userId}> (${formatDuration(elapsedSec)})`;
      })
    : ['Nimeni în listă.'];

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`📋 ${config.zoneName}`)
    .setDescription(state.lastAction || 'Folosește butoanele de mai jos.')
    .addFields(
      { name: '👥 Lista', value: lines.join('\n') },
      { name: '🔢 Total', value: String(active.length), inline: true }
    )
    .setTimestamp(new Date());

  return embed;
};

const canClearList = (member) => {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!config.adminRoleIds.length) return false;
  return config.adminRoleIds.some((roleId) => member.roles?.cache?.has(roleId));
};

const ensurePanelMessage = async () => {
  const channel = await client.channels.fetch(config.zoneChannelId);
  if (!channel?.isTextBased()) {
    throw new Error('ZONE_CHANNEL_ID is not a text channel');
  }

  let message = null;
  const messageId = state.panel.messageId;
  if (messageId) {
    try {
      message = await channel.messages.fetch(messageId);
    } catch {
      message = null;
    }
  }

  if (!message) {
    message = await channel.send({
      embeds: [buildEmbed()],
      components: buildComponents()
    });
  } else {
    await message.edit({
      embeds: [buildEmbed()],
      components: buildComponents()
    });
  }

  state.panel.channelId = channel.id;
  state.panel.messageId = message.id;
  saveState(state);
  return message;
};

const refreshPanel = async () => {
  if (!state.panel.channelId || !state.panel.messageId) {
    await ensurePanelMessage();
    return;
  }

  const channel = await client.channels.fetch(state.panel.channelId);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(state.panel.messageId);
  await message.edit({
    embeds: [buildEmbed()],
    components: buildComponents()
  });
};

const addHistory = (event) => {
  state.history.unshift({
    ...event,
    at: new Date().toISOString()
  });
  state.history = state.history.slice(0, 1000);
};

const getDisplayLabel = async (interaction) => {
  const member = interaction.member;
  if (member && typeof member.displayName === 'string' && member.displayName.trim()) {
    return member.displayName.trim();
  }
  if (interaction.user?.globalName) {
    return interaction.user.globalName;
  }
  return interaction.user.username;
};

const ensureTotalsRow = (userId, label) => {
  if (!state.totals[userId]) {
    state.totals[userId] = {
      label,
      totalSeconds: 0,
      sessions: 0
    };
  } else if (label) {
    state.totals[userId].label = label;
  }
};

const handleEnter = async (interaction) => {
  const userId = interaction.user.id;
  if (state.active[userId]) {
    await interaction.reply({ content: 'Ești deja în listă.', ephemeral: true });
    return;
  }

  const label = await getDisplayLabel(interaction);
  state.active[userId] = {
    label,
    enteredAt: nowTs()
  };
  ensureTotalsRow(userId, label);
  state.lastAction = `🟢 <@${userId}> a intrat.`;
  addHistory({ type: 'enter', userId, label });
  saveState(state);

  await refreshPanel();
  await interaction.reply({ content: 'Ai fost adăugat în listă.', ephemeral: true });
};

const handleExit = async (interaction) => {
  const userId = interaction.user.id;
  const active = state.active[userId];
  if (!active) {
    await interaction.reply({ content: 'Nu ești în listă.', ephemeral: true });
    return;
  }

  const deltaSec = Math.max(0, Math.floor((nowTs() - active.enteredAt) / 1000));
  delete state.active[userId];
  ensureTotalsRow(userId, active.label);
  state.totals[userId].totalSeconds += deltaSec;
  state.totals[userId].sessions += 1;
  state.lastAction = `🔴 <@${userId}> a ieșit după ${formatDuration(deltaSec)}.`;
  addHistory({ type: 'exit', userId, label: active.label, deltaSeconds: deltaSec });
  saveState(state);

  await refreshPanel();
  await interaction.reply({
    content: `Ieșire înregistrată. Timp sesiune: ${formatDuration(deltaSec)} | Total: ${formatDuration(
      state.totals[userId].totalSeconds
    )}.`,
    ephemeral: true
  });
};

const handleClear = async (interaction) => {
  if (!canClearList(interaction.member)) {
    await interaction.reply({ content: 'Nu ai permisiune pentru ștergere listă.', ephemeral: true });
    return;
  }

  state.active = {};
  state.lastAction = `🧹 <@${interaction.user.id}> a șters lista.`;
  addHistory({ type: 'clear', userId: interaction.user.id });
  saveState(state);

  await refreshPanel();
  await interaction.reply({ content: 'Lista a fost resetată.', ephemeral: true });
};

client.once('ready', async () => {
  console.log(`[zone-bot] online as ${client.user.tag}`);

  const guild = await client.guilds.fetch(config.guildId);
  await guild.commands.set([
    {
      name: 'zona-panel',
      description: 'Creează sau reface panoul de intrare/ieșire.'
    },
    {
      name: 'zona-total',
      description: 'Vezi timpul total acumulat pentru tine.'
    }
  ]);

  await ensurePanelMessage();

  setInterval(async () => {
    if (!Object.keys(state.active).length) return;
    try {
      await refreshPanel();
    } catch (error) {
      console.error('[zone-bot] periodic refresh failed', error);
    }
  }, 60_000);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'zona-panel') {
        await ensurePanelMessage();
        await interaction.reply({ content: 'Panoul a fost actualizat.', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'zona-total') {
        const row = state.totals[interaction.user.id];
        const totalSec = row?.totalSeconds ?? 0;
        const sessions = row?.sessions ?? 0;
        await interaction.reply({
          content: `Total acumulat: ${formatDuration(totalSec)} în ${sessions} sesiuni.`,
          ephemeral: true
        });
        return;
      }
    }

    if (!interaction.isButton()) return;
    if (!state.panel.messageId || interaction.message.id !== state.panel.messageId) return;

    if (interaction.customId === ids.enter) {
      await handleEnter(interaction);
      return;
    }
    if (interaction.customId === ids.exit) {
      await handleExit(interaction);
      return;
    }
    if (interaction.customId === ids.clear) {
      await handleClear(interaction);
      return;
    }
  } catch (error) {
    console.error('[zone-bot] interaction error', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'A apărut o eroare.', ephemeral: true });
    }
  }
});

client.login(config.token);

import { Client } from 'discord.js';

let discordClient: Client | null = null;

export const setDiscordClient = (client: Client): void => {
  discordClient = client;
};

export const getDiscordClient = (): Client | null => discordClient;


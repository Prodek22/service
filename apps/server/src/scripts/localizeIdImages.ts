import { EmployeeStatus } from '@prisma/client';
import { ChannelType, Client, GatewayIntentBits } from 'discord.js';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { isLocalIdImageUrl, saveIdImageLocally } from '../services/idImageStorage';

type EmployeeImageRow = {
  id: number;
  iban: string | null;
  nickname: string | null;
  idImageUrl: string | null;
  cvChannelId: string | null;
  cvMessageId: string | null;
};

const CONCURRENCY = 3;

const isImageAttachment = (name?: string | null, contentType?: string | null): boolean => {
  if (contentType?.startsWith('image/')) {
    return true;
  }

  if (!name) {
    return false;
  }

  return /(png|jpg|jpeg|webp|gif|heic|heif)$/i.test(name);
};

const mapLimit = async <T, R>(
  input: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const safeConcurrency = Math.max(1, Math.min(concurrency, 20));
  const results: R[] = new Array(input.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < input.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(input[currentIndex]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(safeConcurrency, input.length) }, () => worker()));
  return results;
};

const run = async () => {
  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });
  try {
    await discordClient.login(env.DISCORD_TOKEN);

    const resolveFreshAttachment = async (row: EmployeeImageRow): Promise<{
      url: string;
      name?: string;
      contentType?: string | null;
    } | null> => {
      if (!row.cvChannelId || !row.cvMessageId) {
        return null;
      }

      try {
        const channel = await discordClient.channels.fetch(row.cvChannelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
          return null;
        }

        const message = await channel.messages.fetch(row.cvMessageId);
        if (!message) {
          return null;
        }

        const image = [...message.attachments.values()].find((attachment) =>
          isImageAttachment(attachment.name, attachment.contentType)
        );

        if (!image) {
          return null;
        }

        return {
          url: image.url,
          name: image.name,
          contentType: image.contentType
        };
      } catch {
        return null;
      }
    };

    const rows = await prisma.employee.findMany({
      where: {
        status: {
          not: EmployeeStatus.DELETED
        },
        idImageUrl: {
          not: null
        }
      },
      select: {
        id: true,
        iban: true,
        nickname: true,
        idImageUrl: true,
        cvChannelId: true,
        cvMessageId: true
      }
    });

    const targets = rows.filter((row) => row.idImageUrl && !isLocalIdImageUrl(row.idImageUrl));
    console.log(`[id-images] Found ${targets.length} remote images to localize.`);

    let migrated = 0;
    let unchanged = 0;
    let failed = 0;
    let recoveredWithDiscordRefetch = 0;

    const outcomes = await mapLimit(targets as EmployeeImageRow[], CONCURRENCY, async (row) => {
      const url = String(row.idImageUrl ?? '');
      try {
        const localUrl = await saveIdImageLocally({ url });
        if (!localUrl || localUrl === url) {
          unchanged += 1;
          return;
        }

        await prisma.employee.update({
          where: { id: row.id },
          data: {
            idImageUrl: localUrl
          }
        });

        migrated += 1;
        console.log(
          `[id-images] migrated employee=${row.id} iban=${row.iban ?? '-'} nickname=${row.nickname ?? '-'}`
        );
      } catch (error) {
        const freshAttachment = await resolveFreshAttachment(row);
        if (freshAttachment) {
          try {
            const localizedFromFresh = await saveIdImageLocally(freshAttachment);
            if (localizedFromFresh && localizedFromFresh !== url) {
              await prisma.employee.update({
                where: { id: row.id },
                data: {
                  idImageUrl: localizedFromFresh
                }
              });

              migrated += 1;
              recoveredWithDiscordRefetch += 1;
              console.log(
                `[id-images] recovered-from-discord employee=${row.id} iban=${row.iban ?? '-'} nickname=${row.nickname ?? '-'}`
              );
              return;
            }
          } catch (freshError) {
            failed += 1;
            console.warn(
              `[id-images] failed-after-discord-refetch employee=${row.id} iban=${row.iban ?? '-'} nickname=${row.nickname ?? '-'} url=${url}`,
              freshError
            );
            return;
          }
        }

        failed += 1;
        console.warn(
          `[id-images] failed employee=${row.id} iban=${row.iban ?? '-'} nickname=${row.nickname ?? '-'} url=${url}`,
          error
        );
      }
    });

    void outcomes;
    console.log(
      `[id-images] Done. migrated=${migrated}, unchanged=${unchanged}, failed=${failed}, recoveredWithDiscordRefetch=${recoveredWithDiscordRefetch}`
    );
  } finally {
    discordClient.destroy();
  }
};

run()
  .catch((error) => {
    console.error('[id-images] Fatal error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

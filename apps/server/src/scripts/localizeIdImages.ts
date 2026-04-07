import { EmployeeStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { isLocalIdImageUrl, saveIdImageLocally } from '../services/idImageStorage';

type EmployeeImageRow = {
  id: number;
  iban: string | null;
  nickname: string | null;
  idImageUrl: string | null;
};

const CONCURRENCY = 4;

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
      idImageUrl: true
    }
  });

  const targets = rows.filter((row) => row.idImageUrl && !isLocalIdImageUrl(row.idImageUrl));
  console.log(`[id-images] Found ${targets.length} remote images to localize.`);

  let migrated = 0;
  let unchanged = 0;
  let failed = 0;

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
      failed += 1;
      console.warn(
        `[id-images] failed employee=${row.id} iban=${row.iban ?? '-'} nickname=${row.nickname ?? '-'} url=${url}`,
        error
      );
    }
  });

  void outcomes;
  console.log(`[id-images] Done. migrated=${migrated}, unchanged=${unchanged}, failed=${failed}`);
};

run()
  .catch((error) => {
    console.error('[id-images] Fatal error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

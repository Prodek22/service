import { prisma } from '../db/prisma';
import { backfillEmployeeRankHistoryFromExistingData } from '../services/rankHistoryService';

const run = async () => {
  console.log('[rank-history] backfill started...');
  const result = await backfillEmployeeRankHistoryFromExistingData();
  console.log(
    `[rank-history] done. employees=${result.scannedEmployees} candidates=${result.candidates} inserted=${result.insertedRows}`
  );
};

run()
  .catch((error) => {
    console.error('[rank-history] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

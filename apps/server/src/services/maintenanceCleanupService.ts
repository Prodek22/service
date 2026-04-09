import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { extractLocalIdImageFilename, getIdImageStaticDirs } from './idImageStorage';

type CleanupRetentionResult = {
  keepCycles: number;
  servicesScanned: number;
  deletedCycles: number;
  deletedTimeEvents: number;
  deletedPayrollStatuses: number;
  orphanFilesDeleted: number;
  orphanFilesScanned: number;
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const listFilesInDir = async (dir: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

export const runRetentionCleanup = async (keepCyclesInput: number): Promise<CleanupRetentionResult> => {
  const keepCycles = Math.max(6, Math.min(keepCyclesInput, 260));
  const serviceRows = await prisma.weekCycle.findMany({
    distinct: ['serviceCode'],
    select: {
      serviceCode: true
    }
  });
  const serviceCodes = serviceRows.map((item) => item.serviceCode);

  let deletedCycles = 0;
  let deletedTimeEvents = 0;
  let deletedPayrollStatuses = 0;

  for (const serviceCode of serviceCodes) {
    const cycles = await prisma.weekCycle.findMany({
      where: {
        serviceCode,
        resetMessageId: {
          not: null
        }
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true
      }
    });

    const toDeleteIds = cycles.slice(keepCycles).map((item) => item.id);
    if (!toDeleteIds.length) {
      continue;
    }

    const [eventsResult, payrollResult, cyclesResult] = await prisma.$transaction([
      prisma.timeEvent.deleteMany({
        where: {
          weekCycleId: {
            in: toDeleteIds
          }
        }
      }),
      prisma.timesheetPayrollStatus.deleteMany({
        where: {
          weekCycleId: {
            in: toDeleteIds
          }
        }
      }),
      prisma.weekCycle.deleteMany({
        where: {
          id: {
            in: toDeleteIds
          }
        }
      })
    ]);

    deletedTimeEvents += eventsResult.count;
    deletedPayrollStatuses += payrollResult.count;
    deletedCycles += cyclesResult.count;
  }

  const employeeImageRows = await prisma.employee.findMany({
    where: {
      idImageUrl: {
        not: null
      }
    },
    select: {
      idImageUrl: true
    }
  });
  const referencedLocalFiles = new Set(
    employeeImageRows
      .map((row) => extractLocalIdImageFilename(row.idImageUrl))
      .filter((value): value is string => Boolean(value))
  );

  const allDirs = unique(getIdImageStaticDirs());
  let orphanFilesScanned = 0;
  let orphanFilesDeleted = 0;

  for (const dir of allDirs) {
    const files = await listFilesInDir(dir);
    orphanFilesScanned += files.length;

    for (const fileName of files) {
      if (referencedLocalFiles.has(fileName)) {
        continue;
      }

      const absolutePath = path.join(dir, fileName);
      try {
        await fs.unlink(absolutePath);
        orphanFilesDeleted += 1;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  return {
    keepCycles,
    servicesScanned: serviceCodes.length,
    deletedCycles,
    deletedTimeEvents,
    deletedPayrollStatuses,
    orphanFilesDeleted,
    orphanFilesScanned
  };
};

import { EmployeeStatus, ParseStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { parseCvMessage } from '../parsers/cvParser';
import { MessageInput } from '../types';
import { normalizeForCompare } from '../utils/normalize';
import { ensureEmployeeAliases } from './employeeMatcher';

const isImageAttachment = (name?: string, contentType?: string | null): boolean => {
  if (contentType?.startsWith('image/')) {
    return true;
  }

  if (!name) {
    return false;
  }

  return /(png|jpg|jpeg|webp|gif)$/i.test(name);
};

const evaluateStatus = (fields: {
  iban?: string | null;
  fullName?: string | null;
  nickname?: string | null;
  idImageUrl?: string | null;
}): EmployeeStatus => {
  const hasMainFields = Boolean(fields.iban && fields.fullName && fields.nickname);

  if (!hasMainFields || !fields.idImageUrl) {
    return EmployeeStatus.INCOMPLETE;
  }

  return EmployeeStatus.ACTIVE;
};

const findByNameAndNickname = async (fullName?: string, nickname?: string) => {
  const normalizedFullName = normalizeForCompare(fullName ?? '');
  const normalizedNickname = normalizeForCompare(nickname ?? '');

  if (!normalizedFullName || !normalizedNickname) {
    return null;
  }

  const candidates = await prisma.employee.findMany({
    where: {
      deletedAt: null
    },
    take: 500
  });

  return (
    candidates.find((employee) => {
      const employeeFullName = normalizeForCompare(employee.fullName ?? '');
      const employeeNickname = normalizeForCompare(employee.nickname ?? '');

      return employeeFullName === normalizedFullName && employeeNickname === normalizedNickname;
    }) ?? null
  );
};

const getParseStatus = (notes: string[]): ParseStatus => {
  if (!notes.length) {
    return ParseStatus.SUCCESS;
  }

  if (notes.length <= 2) {
    return ParseStatus.PARTIAL;
  }

  return ParseStatus.FAILED;
};

const serializeAttachments = (message: MessageInput): string =>
  JSON.stringify(
    message.attachments.map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      name: attachment.name,
      contentType: attachment.contentType
    }))
  );

export const processCvMessage = async (message: MessageInput) => {
  const parsed = parseCvMessage(message.content, message.attachments);

  let employee = await prisma.employee.findUnique({
    where: {
      cvMessageId: message.id
    }
  });

  if (!employee && parsed.iban) {
    employee = await prisma.employee.findUnique({
      where: {
        iban: parsed.iban
      }
    });
  }

  if (!employee) {
    employee = await findByNameAndNickname(parsed.fullName, parsed.nickname);
  }

  const imageFromAttachments = message.attachments.find((attachment) => isImageAttachment(attachment.name, attachment.contentType))?.url;

  const nextData = {
    discordUserId: message.authorId,
    nickname: parsed.nickname,
    fullName: parsed.fullName,
    phone: parsed.phone,
    plateNumber: parsed.plateNumber,
    iban: parsed.iban,
    monthsInCity: parsed.monthsInCity,
    employerName: parsed.employerName,
    recommendation: parsed.recommendation,
    rank: parsed.rank,
    idImageUrl: parsed.idImageUrl ?? imageFromAttachments,
    cvMessageId: message.id,
    cvChannelId: message.channelId,
    cvPostedAt: message.createdAt,
    deletedAt: null
  };

  const mergedForStatus = {
    iban: nextData.iban ?? employee?.iban,
    fullName: nextData.fullName ?? employee?.fullName,
    nickname: nextData.nickname ?? employee?.nickname,
    idImageUrl: nextData.idImageUrl ?? employee?.idImageUrl
  };

  const status = evaluateStatus(mergedForStatus);

  const saved = employee
    ? await prisma.employee.update({
        where: { id: employee.id },
        data: {
          ...nextData,
          status
        }
      })
    : await prisma.employee.create({
        data: {
          ...nextData,
          status
        }
      });

  await prisma.employeeCvRaw.create({
    data: {
      employeeId: saved.id,
      rawText: message.content,
      rawAttachmentsJson: serializeAttachments(message),
      parseStatus: getParseStatus(parsed.notes),
      parseNotes: parsed.notes.join('; ')
    }
  });

  await ensureEmployeeAliases(saved.id, [saved.nickname ?? '', saved.fullName ?? '', saved.discordUserId ?? '']);

  return saved;
};

export const markCvMessageDeleted = async (messageId: string): Promise<void> => {
  const employee = await prisma.employee.findUnique({
    where: {
      cvMessageId: messageId
    }
  });

  if (!employee) {
    return;
  }

  await prisma.employee.update({
    where: {
      id: employee.id
    },
    data: {
      status: EmployeeStatus.DELETED,
      deletedAt: new Date()
    }
  });
};

export const attachIdImageFromReply = async (message: MessageInput): Promise<boolean> => {
  if (!message.referencedMessageId || !message.attachments.length) {
    return false;
  }

  const image = message.attachments.find((attachment) => isImageAttachment(attachment.name, attachment.contentType));

  if (!image) {
    return false;
  }

  const employee = await prisma.employee.findUnique({
    where: {
      cvMessageId: message.referencedMessageId
    }
  });

  if (!employee) {
    return false;
  }

  if (!employee.idImageUrl) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        idImageUrl: image.url,
        status: evaluateStatus({
          iban: employee.iban,
          fullName: employee.fullName,
          nickname: employee.nickname,
          idImageUrl: image.url
        })
      }
    });
  }

  await prisma.employeeCvRaw.create({
    data: {
      employeeId: employee.id,
      rawText: message.content,
      rawAttachmentsJson: serializeAttachments(message),
      parseStatus: ParseStatus.PARTIAL,
      parseNotes: 'Poza asociata prin reply la CV'
    }
  });

  return true;
};


import { EmployeeStatus, ParseStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { parseCvMessage } from '../parsers/cvParser';
import { MessageInput, ParsedCv } from '../types';
import { normalizeForCompare } from '../utils/normalize';
import { ensureEmployeeAliases } from './employeeMatcher';
import { deleteLocalIdImage, saveIdImageLocally } from './idImageStorage';

type IdImageSource = {
  url: string;
  name?: string;
  contentType?: string | null;
};

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

const countCvSignals = (parsed: ParsedCv): number => {
  let count = 0;

  if (parsed.iban) count += 1;
  if (parsed.fullName) count += 1;
  if (parsed.phone) count += 1;
  if (parsed.plateNumber) count += 1;
  if (parsed.monthsInCity != null) count += 1;
  if (parsed.nickname) count += 1;
  if (parsed.employerName) count += 1;
  if (parsed.recommendation) count += 1;
  if (parsed.rank) count += 1;

  return count;
};

const extractMentionedUserId = (content: string): string | undefined => {
  const mention = content.match(/<@!?(\d{5,})>/);
  return mention?.[1];
};

const persistIdImageWithFallback = async (
  source: IdImageSource,
  context: string
): Promise<string> => {
  try {
    return await saveIdImageLocally(source);
  } catch (error) {
    console.warn(`[cv] Failed to store ID image locally (${context})`, error);
    return source.url;
  }
};

const attachImageToExistingCv = async (
  message: MessageInput,
  imageSource: IdImageSource
) => {
  const candidateUserIds = [message.authorId, extractMentionedUserId(message.content)]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index) as string[];

  if (!candidateUserIds.length) {
    return null;
  }

  const candidate = await prisma.employee.findFirst({
    where: {
      discordUserId: {
        in: candidateUserIds
      },
      cvChannelId: message.channelId,
      deletedAt: null,
      OR: [{ idImageUrl: null }, { idImageUrl: '' }]
    },
    orderBy: {
      cvPostedAt: 'desc'
    }
  });

  if (!candidate) {
    return null;
  }

  const imageUrl = await persistIdImageWithFallback(imageSource, 'attach-image-to-existing-cv');

  const updated = await prisma.employee.update({
    where: { id: candidate.id },
    data: {
      idImageUrl: imageUrl,
      status: evaluateStatus({
        iban: candidate.iban,
        fullName: candidate.fullName,
        nickname: candidate.nickname,
        idImageUrl: imageUrl
      })
    }
  });

  if (candidate.idImageUrl && candidate.idImageUrl !== imageUrl) {
    await deleteLocalIdImage(candidate.idImageUrl);
  }

  await prisma.employeeCvRaw.create({
    data: {
      employeeId: candidate.id,
      rawText: message.content,
      rawAttachmentsJson: serializeAttachments(message),
      parseStatus: ParseStatus.PARTIAL,
      parseNotes: 'Poza asociata automat din mesaj separat'
    }
  });

  return updated;
};

export const processCvMessage = async (
  message: MessageInput,
  options?: {
    rankFromRole?: string | null;
    nicknameFromGuild?: string | null;
    entryDateFromGuild?: Date | null;
  }
) => {
  const parsed = parseCvMessage(message.content, message.attachments);
  const imageAttachment = message.attachments.find((attachment) =>
    isImageAttachment(attachment.name, attachment.contentType)
  );
  const cvSignals = countCvSignals(parsed);
  const parsedImageSource = parsed.idImageUrl
    ? {
        url: parsed.idImageUrl
      }
    : null;
  const attachmentImageSource = imageAttachment
    ? {
        url: imageAttachment.url,
        name: imageAttachment.name,
        contentType: imageAttachment.contentType
      }
    : null;
  const imageSource = attachmentImageSource ?? parsedImageSource;

  // Skip noise messages from the CV channel and auto-link image-only messages to an existing CV.
  if (cvSignals === 0 && !imageSource) {
    return null;
  }

  if (cvSignals === 0 && imageSource) {
    const attached = await attachImageToExistingCv(message, imageSource);
    if (attached) {
      return attached;
    }

    return null;
  }

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

  const persistedIdImageUrl = imageSource
    ? await persistIdImageWithFallback(imageSource, 'process-cv-message')
    : undefined;

  const nextData = {
    discordUserId: message.authorId,
    nickname: options?.nicknameFromGuild ?? parsed.nickname,
    fullName: parsed.fullName,
    phone: parsed.phone,
    plateNumber: parsed.plateNumber,
    iban: parsed.iban,
    monthsInCity: parsed.monthsInCity,
    employerName: parsed.employerName,
    recommendation: parsed.recommendation,
    rank: options?.rankFromRole ?? parsed.rank,
    idImageUrl: persistedIdImageUrl,
    cvMessageId: message.id,
    cvChannelId: message.channelId,
    cvPostedAt: options?.entryDateFromGuild ?? message.createdAt,
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

  if (employee?.idImageUrl && persistedIdImageUrl && employee.idImageUrl !== persistedIdImageUrl) {
    await deleteLocalIdImage(employee.idImageUrl);
  }

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

  const persistedImageUrl = await persistIdImageWithFallback(
    {
      url: image.url,
      name: image.name,
      contentType: image.contentType
    },
    'attach-id-image-from-reply'
  );

  if (!employee.idImageUrl) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        idImageUrl: persistedImageUrl,
        status: evaluateStatus({
          iban: employee.iban,
          fullName: employee.fullName,
          nickname: employee.nickname,
          idImageUrl: persistedImageUrl
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


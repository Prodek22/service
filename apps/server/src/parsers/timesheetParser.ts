import { ParsedTimeEvent } from '../types';
import { normalizeForCompare, normalizeWhitespace } from '../utils/normalize';

type Mention = {
  raw: string;
  source: 'discord' | 'text';
  discordId?: string;
  code?: string;
  name?: string;
};

const parseMentions = (rawText: string): Mention[] => {
  const mentions: Mention[] = [];

  const discordMatches = rawText.matchAll(/<@!?([0-9]{5,})>/g);
  for (const match of discordMatches) {
    mentions.push({ raw: match[0], source: 'discord', discordId: match[1] });
  }

  const textualMatches = rawText.matchAll(/@([\p{L}0-9_.-]+)(?:\s*-\s*([0-9]{3,}))?/gu);
  for (const match of textualMatches) {
    const raw = match[0];
    if (mentions.some((existing) => existing.raw === raw)) {
      continue;
    }

    mentions.push({ raw, source: 'text', code: match[2], name: match[1] });
  }

  return mentions;
};

const parseServiceCode = (rawText: string): string | undefined => {
  const patterns = [
    /pentru\s+codul\s+([a-z0-9_-]+)/i,
    /pentru\s+([a-z0-9_-]+)\s*(?:,|\.|$)/i,
    /in\s+([a-z0-9_-]+)\s*(?:,|\.|$)/i,
    /service\s*[:\-]?\s*([a-z0-9_-]+)/i
  ];

  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  if (/service/i.test(rawText)) {
    return 'service';
  }

  return undefined;
};

const parseDeltaSeconds = (rawText: string): number | undefined => {
  const normalized = normalizeWhitespace(rawText);

  // We explicitly parse numeric signs so "-893 minute" remains negative even if text says "adaugat".
  const signedMinutes = normalized.match(/([+-]?\d+)\s*minute?/i);
  const secondsPart = normalized.match(/([+-]?\d+)\s*sec(?:unde?)?/i);

  if (!signedMinutes && !secondsPart) {
    return undefined;
  }

  const minuteValue = signedMinutes ? Number.parseInt(signedMinutes[1], 10) : 0;
  let secondValue = secondsPart ? Number.parseInt(secondsPart[1], 10) : 0;

  // If minutes are negative and seconds are positive textually, keep the same sign.
  if (minuteValue < 0 && secondValue > 0) {
    secondValue = -secondValue;
  }

  return minuteValue * 60 + secondValue;
};

export const parseTimesheetMessage = (rawText: string): ParsedTimeEvent => {
  const normalized = normalizeForCompare(rawText);
  const mentions = parseMentions(rawText);
  const discordMentions = mentions.filter((mention) => mention.source === 'discord');
  const textMentions = mentions.filter((mention) => mention.source === 'text');
  const serviceCode = parseServiceCode(rawText);
  const deltaSeconds = parseDeltaSeconds(rawText);

  const firstDiscordId = discordMentions[0]?.discordId;
  const secondDiscordId = discordMentions[1]?.discordId;
  const firstTextName = textMentions[0]?.name;
  const secondTextName = textMentions[1]?.name;

  const hasClockIn = normalized.includes('pontajul in desfasurare');
  const hasClockOut = normalized.includes('pontajul incheiat');
  const hasManualClose = normalized.includes('i a inchis pontajul') || normalized.includes('i s au adaugat');
  const hasReset = normalized.includes('a resetat toate timpurile');

  if (hasReset) {
    return {
      eventType: 'WEEKLY_RESET',
      actorDiscordUserId: firstDiscordId,
      actorName: firstTextName,
      serviceCode,
      deltaSeconds
    };
  }

  if (hasClockIn) {
    return {
      eventType: 'CLOCK_IN',
      discordUserId: firstDiscordId,
      targetEmployeeName: firstTextName,
      serviceCode
    };
  }

  if (hasClockOut) {
    return {
      eventType: 'CLOCK_OUT',
      discordUserId: firstDiscordId,
      targetEmployeeName: firstTextName,
      serviceCode,
      deltaSeconds
    };
  }

  if (hasManualClose || (typeof deltaSeconds === 'number' && normalized.includes('ajust'))) {
    return {
      eventType: 'MANUAL_ADJUSTMENT',
      actorDiscordUserId: firstDiscordId,
      actorName: firstTextName,
      discordUserId: secondDiscordId ?? firstDiscordId,
      targetEmployeeName: secondTextName ?? firstTextName,
      serviceCode,
      deltaSeconds
    };
  }

  return {
    eventType: 'UNKNOWN',
    discordUserId: firstDiscordId,
    targetEmployeeName: firstTextName,
    serviceCode,
    deltaSeconds
  };
};


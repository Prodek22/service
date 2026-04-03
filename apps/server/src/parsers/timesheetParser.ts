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
  const normalized = normalizeWhitespace(rawText.replace(/[*_`~]/g, '').replace(/−/g, '-'));
  const lower = normalized.toLowerCase();

  // In messages like "a adaugat -90 minute ..., facandu-i noul timp sa fie 9 ore, 10 minute..."
  // we only parse the delta segment before "noul timp", otherwise we'd incorrectly read the final total.
  const newTotalIndex = lower.indexOf('noul timp');
  const deltaSource = newTotalIndex >= 0 ? normalized.slice(0, newTotalIndex) : normalized;

  // We explicitly parse numeric signs so "-893 minute" remains negative even if text says "adaugat".
  const signedHours = deltaSource.match(/([+-]?\s*\d+)\s*(?:ora|ore)\b/i);
  const signedMinutes = deltaSource.match(/([+-]?\s*\d+)\s*minute?/i);
  const secondsPart = deltaSource.match(/([+-]?\s*\d+)\s*sec(?:unde?)?/i);

  if (!signedHours && !signedMinutes && !secondsPart) {
    return undefined;
  }

  const rawHour = signedHours?.[1]?.replace(/\s+/g, '') ?? '';
  const rawMinute = signedMinutes?.[1]?.replace(/\s+/g, '') ?? '';
  const rawSecond = secondsPart?.[1]?.replace(/\s+/g, '') ?? '';

  let hourValue = rawHour ? Number.parseInt(rawHour, 10) : 0;
  let minuteValue = rawMinute ? Number.parseInt(rawMinute, 10) : 0;
  let secondValue = rawSecond ? Number.parseInt(rawSecond, 10) : 0;

  const hourHasExplicitSign = /^[-+]/.test(rawHour);
  const minuteHasExplicitSign = /^[-+]/.test(rawMinute);
  const secondHasExplicitSign = /^[-+]/.test(rawSecond);

  const hasNegativeCue =
    /\b(?:minus|scaz(?:ut|and|ute)?|retras|retrage|dedus|penaliz(?:are|at|ata)?)\b/i.test(deltaSource) ||
    /-\s*\d+/.test(deltaSource);
  const hasPositiveCue = /\b(?:adaug(?:at|and|ate)?|plus)\b/i.test(deltaSource);

  const inferredSign =
    hourValue < 0 || minuteValue < 0 || secondValue < 0
      ? -1
      : hourValue > 0 || minuteValue > 0 || secondValue > 0
        ? hasNegativeCue && !hasPositiveCue
          ? -1
          : 1
        : 1;

  if (inferredSign < 0) {
    if (hourValue > 0 && !hourHasExplicitSign) hourValue = -hourValue;
    if (minuteValue > 0 && !minuteHasExplicitSign) minuteValue = -minuteValue;
    if (secondValue > 0 && !secondHasExplicitSign) secondValue = -secondValue;
  } else if (inferredSign > 0) {
    if (hourValue < 0 && !hourHasExplicitSign) hourValue = -hourValue;
    if (minuteValue < 0 && !minuteHasExplicitSign) minuteValue = -minuteValue;
    if (secondValue < 0 && !secondHasExplicitSign) secondValue = -secondValue;
  }

  return hourValue * 3600 + minuteValue * 60 + secondValue;
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

  const hasClockIn =
    /pontaj(?:ul)?/.test(normalized) &&
    (normalized.includes('in desfasurare') || normalized.includes('inceput') || normalized.includes('pornit'));
  const hasClockOut =
    /pontaj(?:ul)?/.test(normalized) &&
    (normalized.includes('incheiat') || normalized.includes('inchis') || normalized.includes('oprit'));
  const hasManualClose =
    normalized.includes('i a inchis pontajul') ||
    normalized.includes('i s au adaugat') ||
    normalized.includes('adaugand');
  const hasResetVerb =
    /\breset(?:at|ata|ate|ati)?\b/.test(normalized) ||
    /\bsters(?:|a|e|i)\b/.test(normalized) ||
    /\bsterg(?:e|erea|ut)\b/.test(normalized);
  const hasTimesKeyword = /\btimp(?:ul|urile|urile totale|urile de pontaj|ului)?\b/.test(normalized);
  const hasResetScope =
    /\b(toate|toata)\b/.test(normalized) ||
    normalized.includes('au fost') ||
    normalized.includes('pentru codul');
  const hasReset = hasResetVerb && hasTimesKeyword && hasResetScope;

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

  if (
    hasManualClose ||
    (typeof deltaSeconds === 'number' &&
      (normalized.includes('ajust') || normalized.includes('adaugand') || normalized.includes('timpului')))
  ) {
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


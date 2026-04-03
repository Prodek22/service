import { AttachmentInput, ParsedCv } from '../types';
import { levenshtein, normalizeForCompare, normalizeLabel, normalizeWhitespace } from '../utils/normalize';

type CvFieldKey =
  | 'iban'
  | 'fullName'
  | 'phone'
  | 'plateNumber'
  | 'monthsInCity'
  | 'nickname'
  | 'employerName'
  | 'recommendation'
  | 'rank'
  | 'idImage';

const FIELD_SYNONYMS: Record<CvFieldKey, string[]> = {
  iban: ['iban', 'cont bancar', 'nr iban'],
  fullName: ['nume si prenumele', 'nume prenume', 'nume complet', 'nume', 'pronume'],
  phone: ['numar de telefon', 'telefon', 'nr telefon', 'numar telefon', 'numar tel', 'nr tel', 'phone'],
  plateNumber: ['numar de inmatriculare', 'numar inmatriculare', 'nr inmatriculare', 'plate', 'inmatriculare'],
  monthsInCity: ['numarul de luni in oras', 'luni in oras', 'numar luni', 'luni oras'],
  nickname: ['porecla', 'nickname', 'nick', 'nume rp'],
  employerName: ['numele angajatorului', 'angajator', 'employer', 'nume angajator'],
  recommendation: ['recomandare', 'recomandari', 'cine te recomanda'],
  rank: ['rank', 'grad', 'functie'],
  idImage: ['copie dupa buletin', 'buletin', 'poza buletin', 'id card']
};

const mentionOnlyRegex = /^<@!?\d+>$|^@[\p{L}0-9_.-]+(?:\s*-\s*\d+)?$/u;

const sanitizePersonName = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = normalizeWhitespace(value.replace(/<@!?\d+>/g, ''));

  if (!trimmed || mentionOnlyRegex.test(trimmed)) {
    return undefined;
  }

  return trimmed;
};

const sanitizeNickname = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const cleaned = normalizeWhitespace(value.replace(/<@!?\d+>/g, '').replace(/^@+/, ''));
  return cleaned || undefined;
};

const getDistanceThreshold = (length: number): number => {
  if (length <= 5) {
    return 1;
  }

  if (length <= 12) {
    return 2;
  }

  return 3;
};

const scoreLabelMatch = (label: string, synonym: string): number | null => {
  const normalizedSynonym = normalizeLabel(synonym);

  if (!label || !normalizedSynonym) {
    return null;
  }

  if (label === normalizedSynonym) {
    return 0;
  }

  const distance = levenshtein(label, normalizedSynonym);
  const maxDistance = getDistanceThreshold(normalizedSynonym.length);

  if (distance <= maxDistance && Math.abs(label.length - normalizedSynonym.length) <= maxDistance + 1) {
    return distance;
  }

  return null;
};

const guessFieldKey = (rawLabel: string): CvFieldKey | null => {
  const label = normalizeLabel(rawLabel);

  if (!label) {
    return null;
  }

  if (label.includes('angajator')) {
    return 'employerName';
  }

  if (label.includes('recomand')) {
    return 'recommendation';
  }

  if (label.includes('inmatricul') || label.includes('plate')) {
    return 'plateNumber';
  }

  if (label.includes('telefon') || label === 'nr tel' || label === 'tel') {
    return 'phone';
  }

  if (label.includes('luni') && label.includes('oras')) {
    return 'monthsInCity';
  }

  if (label.includes('buletin') || label.includes('id card')) {
    return 'idImage';
  }

  let bestMatch: { field: CvFieldKey; score: number; synonymLength: number } | null = null;

  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as [CvFieldKey, string[]][]) {
    for (const synonym of synonyms) {
      const score = scoreLabelMatch(label, synonym);
      if (score == null) {
        continue;
      }

      if (
        !bestMatch ||
        score < bestMatch.score ||
        (score === bestMatch.score && synonym.length > bestMatch.synonymLength)
      ) {
        bestMatch = { field, score, synonymLength: synonym.length };
      }
    }
  }

  return bestMatch?.field ?? null;
};

const parseMonths = (value: string): number | undefined => {
  const match = value.match(/-?\d+/);
  if (!match) {
    return undefined;
  }

  return Number.parseInt(match[0], 10);
};

const pickIdImage = (attachments: AttachmentInput[]): string | undefined => {
  const image = attachments.find((attachment) => {
    const lowerName = attachment.name?.toLowerCase() ?? '';
    const isImageType = attachment.contentType?.startsWith('image/');
    const looksLikeImage = /(png|jpg|jpeg|webp|gif)$/.test(lowerName);

    return Boolean(isImageType || looksLikeImage);
  });

  return image?.url;
};

const hasAnyCvSignals = (parsed: ParsedCv): boolean =>
  Boolean(
    parsed.iban ||
      parsed.fullName ||
      parsed.phone ||
      parsed.plateNumber ||
      parsed.monthsInCity != null ||
      parsed.nickname ||
      parsed.employerName ||
      parsed.recommendation ||
      parsed.rank
  );

export const parseCvMessage = (content: string, attachments: AttachmentInput[]): ParsedCv => {
  const parsed: ParsedCv = {
    notes: []
  };

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const separatorMatch = line.match(/^(.+?)\s*[:\-–]\s*(.+)$/);
    if (!separatorMatch) {
      continue;
    }

    const [, rawLabel, rawValue] = separatorMatch;
    const fieldKey = guessFieldKey(rawLabel);

    if (!fieldKey) {
      continue;
    }

    const value = normalizeWhitespace(rawValue);

    switch (fieldKey) {
      case 'iban':
        parsed.iban = value;
        break;
      case 'fullName':
        parsed.fullName = value;
        break;
      case 'phone':
        parsed.phone = value;
        break;
      case 'plateNumber':
        parsed.plateNumber = value;
        break;
      case 'monthsInCity':
        parsed.monthsInCity = parseMonths(value);
        break;
      case 'nickname':
        parsed.nickname = value;
        break;
      case 'employerName':
        parsed.employerName = value;
        break;
      case 'recommendation':
        parsed.recommendation = value;
        break;
      case 'rank':
        parsed.rank = value;
        break;
      case 'idImage':
        if (/https?:\/\//i.test(value)) {
          parsed.idImageUrl = value;
        }
        break;
      default:
        break;
    }
  }

  const fallbackIban = content.match(/(?:^|\n)\s*iban\s*[:\-]?\s*([a-z0-9-]+)/i);
  if (!parsed.iban && fallbackIban) {
    parsed.iban = fallbackIban[1];
  }

  const fallbackName = content.match(/(?:^|\n)\s*(?:nume(?:\s+si\s+prenumele)?|pronume)\s*[:\-]\s*([^\n]+)/i);
  if (!parsed.fullName && fallbackName) {
    parsed.fullName = normalizeWhitespace(fallbackName[1]);
  }

  const fallbackPhone = content.match(/(?:telefon|nr\.?\s*telefon|numar\s*telefon)\s*[:\-]?\s*([^\n]+)/i);
  if (!parsed.phone && fallbackPhone) {
    parsed.phone = normalizeWhitespace(fallbackPhone[1]);
  }

  const fallbackPlate = content.match(/(?:inmatriculare|plate)\s*[:\-]?\s*([^\n]+)/i);
  if (!parsed.plateNumber && fallbackPlate) {
    parsed.plateNumber = normalizeWhitespace(fallbackPlate[1]);
  }

  const fallbackMonths = content.match(/(?:luni\s*in\s*oras|numar(?:ul)?\s*de\s*luni)\s*[:\-]?\s*(-?\d+)/i);
  if (parsed.monthsInCity == null && fallbackMonths) {
    parsed.monthsInCity = Number.parseInt(fallbackMonths[1], 10);
  }

  const fallbackRank = content.match(/(?:rank|grad|functie)\s*[:\-]?\s*([^\n]+)/i);
  if (!parsed.rank && fallbackRank) {
    parsed.rank = normalizeWhitespace(fallbackRank[1]);
  }

  if (!parsed.idImageUrl) {
    parsed.idImageUrl = pickIdImage(attachments);
  }

  parsed.fullName = sanitizePersonName(parsed.fullName);
  parsed.nickname = sanitizeNickname(parsed.nickname);
  parsed.employerName = parsed.employerName ? normalizeWhitespace(parsed.employerName) : undefined;
  parsed.rank = parsed.rank ? normalizeWhitespace(parsed.rank) : undefined;

  parsed.iban = parsed.iban ? normalizeForCompare(parsed.iban).replace(/\s+/g, '') : undefined;

  if (!hasAnyCvSignals(parsed) && !parsed.idImageUrl) {
    parsed.notes.push('Mesaj fara date CV utile');
    return parsed;
  }

  if (!parsed.iban) {
    parsed.notes.push('IBAN lipsa');
  }

  if (!parsed.fullName) {
    parsed.notes.push('Nume complet lipsa');
  }

  if (!parsed.nickname) {
    parsed.notes.push('Porecla lipsa');
  }

  if (!parsed.idImageUrl) {
    parsed.notes.push('Poza buletin lipsa');
  }

  return parsed;
};

import { AttachmentInput, ParsedCv } from '../types';
import { fuzzyEquals, normalizeForCompare, normalizeLabel, normalizeWhitespace } from '../utils/normalize';

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
  phone: ['numar de telefon', 'telefon', 'nr telefon', 'numar telefon', 'numar tel', 'phone'],
  plateNumber: ['numar de inmatriculare', 'numar inmatriculare', 'nr inmatriculare', 'plate', 'inmatriculare'],
  monthsInCity: ['numarul de luni in oras', 'luni in oras', 'numar luni', 'luni oras'],
  nickname: ['porecla', 'nickname', 'nick', 'nume rp'],
  employerName: ['numele angajatorului', 'angajator', 'employer', 'nume angajator'],
  recommendation: ['recomandare', 'recomandari', 'cine te recomanda'],
  rank: ['rank', 'grad', 'functie'],
  idImage: ['copie dupa buletin', 'buletin', 'poza buletin', 'id card']
};

const guessFieldKey = (rawLabel: string): CvFieldKey | null => {
  const label = normalizeLabel(rawLabel);

  // Label matching is intentionally permissive so typo-heavy roleplay forms still parse.
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as [CvFieldKey, string[]][]) {
    for (const synonym of synonyms) {
      if (fuzzyEquals(label, synonym, 3)) {
        return field;
      }
    }
  }

  return null;
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

export const parseCvMessage = (content: string, attachments: AttachmentInput[]): ParsedCv => {
  const parsed: ParsedCv = {
    notes: []
  };

  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const separatorMatch = line.match(/^(.+?)\s*[:\-Ã¢â‚¬â€œ]\s*(.+)$/);
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

  // Fallback regex extractions handle messages that skip regular "Label: value" formatting.
  const fallbackIban = content.match(/iban\s*[:\-]?\s*([a-z0-9-]+)/i);
  if (!parsed.iban && fallbackIban) {
    parsed.iban = fallbackIban[1];
  }

  const fallbackName = content.match(/(?:nume|pronume)\s*(?:si\s*prenumele|prenumele)?\s*[:\-]?\s*([^\n]+)/i);
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

  parsed.fullName = parsed.fullName ? normalizeWhitespace(parsed.fullName) : undefined;
  parsed.nickname = parsed.nickname ? normalizeWhitespace(parsed.nickname) : undefined;
  parsed.employerName = parsed.employerName ? normalizeWhitespace(parsed.employerName) : undefined;
  parsed.rank = parsed.rank ? normalizeWhitespace(parsed.rank) : undefined;

  // For comparisons and dedup logic, it is useful to keep clean values.
  parsed.iban = parsed.iban ? normalizeForCompare(parsed.iban).replace(/\s+/g, '') : undefined;

  return parsed;
};


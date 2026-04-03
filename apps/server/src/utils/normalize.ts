export const stripDiacritics = (input: string): string =>
  input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

export const normalizeForCompare = (input: string): string =>
  normalizeWhitespace(stripDiacritics(input).toLowerCase())
    .replace(/[._]/g, ' ')
    .replace(/[^a-z0-9@\s-]/g, '');

export const normalizeLabel = (input: string): string =>
  normalizeForCompare(input).replace(/[-]+/g, ' ').trim();

export const levenshtein = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }

  const matrix: number[][] = Array.from({ length: b.length + 1 }, () => []);

  for (let i = 0; i <= b.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= a.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
};

export const fuzzyEquals = (value: string, candidate: string, maxDistance = 2): boolean => {
  const a = normalizeLabel(value);
  const b = normalizeLabel(candidate);

  if (!a || !b) {
    return false;
  }

  if (a.includes(b) || b.includes(a)) {
    return true;
  }

  return levenshtein(a, b) <= maxDistance;
};


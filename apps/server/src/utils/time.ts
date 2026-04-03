export const secondsToHm = (seconds: number): string => {
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const sign = seconds < 0 ? '-' : '';

  return `${sign}${hours}h ${minutes}m`;
};

export const buildCsv = (rows: string[][]): string => {
  const escapeCell = (value: string): string => {
    if (/[,"\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  };

  return rows.map((row) => row.map((cell) => escapeCell(String(cell ?? ''))).join(',')).join('\n');
};


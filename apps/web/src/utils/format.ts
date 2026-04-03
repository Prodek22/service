export const formatDateTime = (iso: string | null): string => {
  if (!iso) {
    return '-';
  }

  return new Date(iso).toLocaleString();
};

export const formatHm = (seconds: number): string => {
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const sign = seconds < 0 ? '-' : '';
  return `${sign}${hours}h ${minutes}m`;
};

export const formatMinutes = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
};

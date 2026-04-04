export const ADMIN_ROLES = ['ADMIN', 'VIEWER'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const normalizeAdminRole = (value: unknown): AdminRole => {
  const input = String(value ?? '')
    .trim()
    .toUpperCase();

  return input === 'VIEWER' ? 'VIEWER' : 'ADMIN';
};

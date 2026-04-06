import { Request, Response } from 'express';
import { prisma } from '../db/prisma';

type AuditLogInput = {
  req: Request;
  res: Response;
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown> | null;
};

const getRequestIp = (req: Request): string | null => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.trim() ?? null;
  }

  return req.ip ?? null;
};

const safeStringify = (value: Record<string, unknown> | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ note: 'metadata_not_serializable' });
  }
};

export const recordAuditLog = async (input: AuditLogInput): Promise<void> => {
  const actor = input.res.locals.authUser as { username?: string; role?: string } | undefined;

  try {
    await prisma.auditLog.create({
      data: {
        actorUsername: actor?.username ?? null,
        actorRole: actor?.role ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId != null ? String(input.entityId) : null,
        metadataJson: safeStringify(input.metadata),
        ipAddress: getRequestIp(input.req),
        userAgent: input.req.headers['user-agent'] ?? null
      }
    });
  } catch (error) {
    console.error('[audit-log] Failed to persist audit entry', error);
  }
};

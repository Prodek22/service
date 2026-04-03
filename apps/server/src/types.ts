export type AttachmentInput = {
  id: string;
  url: string;
  name?: string;
  contentType?: string | null;
};

export type MessageInput = {
  id: string;
  channelId: string;
  content: string;
  authorId?: string;
  createdAt: Date;
  updatedAt?: Date;
  attachments: AttachmentInput[];
  referencedMessageId?: string | null;
};

export type ParsedCv = {
  iban?: string;
  fullName?: string;
  phone?: string;
  plateNumber?: string;
  monthsInCity?: number;
  nickname?: string;
  employerName?: string;
  recommendation?: string;
  rank?: string;
  idImageUrl?: string;
  notes: string[];
};

export type ParsedTimeEvent = {
  eventType: 'CLOCK_IN' | 'CLOCK_OUT' | 'MANUAL_ADJUSTMENT' | 'WEEKLY_RESET' | 'UNKNOWN';
  discordUserId?: string;
  actorDiscordUserId?: string;
  actorName?: string;
  targetEmployeeName?: string;
  serviceCode?: string;
  deltaSeconds?: number;
};


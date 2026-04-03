export type Employee = {
  id: number;
  iban: string | null;
  monthsInCity: number | null;
  nickname: string | null;
  fullName: string | null;
  phone: string | null;
  rank: string | null;
  cvPostedAt: string | null;
  idImageUrl: string | null;
  status: 'ACTIVE' | 'INCOMPLETE' | 'DELETED';
  employerName: string | null;
  recommendation: string | null;
  plateNumber: string | null;
  isIncomplete: boolean;
  missingIdImage: boolean;
};

export type EmployeesResponse = {
  items: Employee[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type DashboardResponse = {
  currentCycleId: number | null;
  totalActiveEmployees: number;
  totalIncompleteCvs: number;
  totalWeekSeconds: number;
  totalWeekLabel: string;
  topEmployees: Array<{
    displayName: string;
    totalSeconds: number;
    totalLabel: string;
  }>;
};

export type WeekCycle = {
  id: number;
  serviceCode: string;
  startedAt: string;
  endedAt: string | null;
  resetMessageId: string | null;
};

export type TimesheetSummaryResponse = {
  cycleId: number | null;
  totals: Array<{
    key: string;
    employeeId: number | null;
    employeeCode: string | null;
    displayName: string;
    discordUserId: string | null;
    totalSeconds: number;
    normalSeconds: number;
    manualAdjustmentSeconds: number;
    positiveAdjustmentSeconds: number;
    negativeAdjustmentSeconds: number;
    manualAdjustmentsCount: number;
    eventsCount: number;
    totalLabel: string;
    normalLabel: string;
    manualLabel: string;
  }>;
};

export type TimeEventHistoryResponse = {
  cycleId: number;
  history: Array<{
    id: number;
    eventType: string;
    deltaSeconds: number | null;
    rawText: string;
    eventAt: string;
    serviceCode: string | null;
  }>;
};

export type EmployeeCvRawEntry = {
  id: number;
  rawText: string;
  rawAttachmentsJson: string | null;
  parseStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  parseNotes: string | null;
  createdAt: string;
};

export type AuthMeResponse = {
  authenticated: boolean;
  username?: string;
};

export type DeleteOldResponse = {
  ok: boolean;
  olderThanDays: number;
  deleted: {
    timeEvents: number;
    weekCycles: number;
    employees: number;
  };
};

export type SyncNewResponse = {
  ok: boolean;
  latestLimitPerChannel: number;
  processed: {
    cvProcessed: number;
    timesheetProcessed: number;
  };
};

export type RebuildAllResponse = {
  ok: boolean;
  deleted: {
    employees: 'all';
    employeeCvRaw: 'all';
    employeeAliases: 'all';
    weekCycles: 'all';
    timeEvents: 'all';
  };
  processed: {
    cvProcessed: number;
    timesheetProcessed: number;
  };
};

export type SyncTimesheetWindowResponse = {
  ok: boolean;
  message: string;
  job: MaintenanceJobStatus;
};

export type MaintenanceJobStatus = {
  id: string | null;
  type: 'sync-new' | 'sync-timesheet-window' | 'rebuild-all' | 'sync-employees-incremental' | null;
  state: 'idle' | 'running' | 'success' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type MaintenanceStartResponse = {
  ok: boolean;
  message: string;
  job: MaintenanceJobStatus;
};

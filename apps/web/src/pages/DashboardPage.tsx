import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import {
  DashboardResponse,
  InactiveReportResponse,
  MaintenanceJobStatus,
  MaintenanceStartResponse
} from '../types';
import { formatDate, formatDateTime } from '../utils/format';

type DashboardPageProps = {
  canManage?: boolean;
};

type IconName =
  | 'people'
  | 'document'
  | 'clock'
  | 'hash'
  | 'gauge'
  | 'target'
  | 'pulse'
  | 'stack'
  | 'calendar'
  | 'search'
  | 'alert'
  | 'sync';

const renderIcon = (name: IconName) => (
  <span className={`dashboard-icon-glyph ${name}`} aria-hidden="true" />
);

export const DashboardPage = ({ canManage = false }: DashboardPageProps) => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [inactiveReport, setInactiveReport] = useState<InactiveReportResponse | null>(null);
  const [inactiveLoading, setInactiveLoading] = useState(false);
  const [inactiveError, setInactiveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<MaintenanceJobStatus | null>(null);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const loadDashboard = async () => {
    setError(null);
    setData(null);
    void apiGet<DashboardResponse>('/dashboard')
      .then(setData)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Eroare dashboard'));
  };

  const loadInactiveReport = async () => {
    setInactiveLoading(true);
    setInactiveError(null);

    try {
      const response = await apiGet<InactiveReportResponse>('/dashboard/inactive-report');
      setInactiveReport(response);
    } catch (loadError) {
      setInactiveError(loadError instanceof Error ? loadError.message : 'Nu am putut genera raportul de inactivi.');
    } finally {
      setInactiveLoading(false);
    }
  };

  const pollJobStatus = async () => {
    try {
      const status = await apiGet<MaintenanceJobStatus>('/maintenance/job-status');
      setJobStatus(status);

      if (status.state === 'running') {
        pollTimerRef.current = window.setTimeout(() => {
          void pollJobStatus();
        }, 1000);
        return;
      }

      setMaintenanceBusy(false);

      if (status.state === 'success') {
        const payload = status.result;
        if (payload && typeof payload === 'object') {
          const processed = (payload as { processed?: { cvProcessed?: number; timesheetProcessed?: number } }).processed;
          const cv = processed?.cvProcessed ?? 0;
          const timesheet = processed?.timesheetProcessed ?? 0;
          setMaintenanceMessage(`Job finalizat. CV procesate: ${cv}, pontaje procesate: ${timesheet}.`);
        } else {
          setMaintenanceMessage('Job finalizat cu succes.');
        }
        await loadDashboard();
        return;
      }

      if (status.state === 'failed') {
        setMaintenanceMessage(`Job esuat: ${status.error ?? 'eroare necunoscuta'}`);
      }
    } catch (pollError) {
      setMaintenanceBusy(false);
      setMaintenanceMessage(pollError instanceof Error ? pollError.message : 'Nu am putut citi statusul jobului.');
    }
  };

  const startBackgroundJob = async (endpoint: string, body: Record<string, unknown>, startedLabel: string) => {
    setMaintenanceBusy(true);
    setMaintenanceMessage(null);
    setDisplayedProgress(0);

    try {
      const response = await apiPost<MaintenanceStartResponse>(endpoint, body);
      setJobStatus(response.job);
      setMaintenanceMessage(`${startedLabel} Job ID: ${response.job.id}`);
      stopPolling();
      await pollJobStatus();
    } catch (actionError) {
      setMaintenanceBusy(false);
      setMaintenanceMessage(actionError instanceof Error ? actionError.message : 'Nu am putut porni jobul.');
    }
  };

  useEffect(() => {
    void loadDashboard();

    if (canManage) {
      void pollJobStatus();
    }

    return () => {
      stopPolling();
    };
  }, [canManage]);

  useEffect(() => {
    if (!jobStatus || jobStatus.state !== 'running') {
      if (jobStatus?.state === 'success') {
        setDisplayedProgress(100);
      }
      return;
    }

    const target = Math.max(0, Math.min(100, jobStatus.progressPercent ?? 0));
    const timer = window.setInterval(() => {
      setDisplayedProgress((current) => {
        if (current >= target) {
          return current;
        }

        const next = current + Math.max(1, Math.ceil((target - current) / 6));
        return Math.min(target, next);
      });
    }, 120);

    return () => {
      window.clearInterval(timer);
    };
  }, [jobStatus?.state, jobStatus?.progressPercent]);

  const syncEmployeesIncremental = async () => {
    await startBackgroundJob(
      '/maintenance/sync-employees-incremental',
      { lookbackDays: 14 },
      'Sync incremental angajati pornit.'
    );
  };

  const syncCurrentWeekTimesheets = async () => {
    await startBackgroundJob('/maintenance/sync-timesheet-window', { days: 14 }, 'Sync pontaje saptamana in curs pornit.');
  };

  const rebuildAllCvData = async () => {
    const confirmed = window.confirm('Se va reprocesa complet canalul CV (fara reset la pontaje). Continui?');

    if (!confirmed) {
      return;
    }

    await startBackgroundJob('/maintenance/rebuild-cv-all', {}, 'Rebuild complet CV-uri pornit.');
  };

  const recalculateTimesheets = async () => {
    const confirmed = window.confirm('Se vor recalcula toate evenimentele de pontaj pe toate ciclurile. Continui?');

    if (!confirmed) {
      return;
    }

    await startBackgroundJob('/maintenance/recalculate-timesheets', {}, 'Recalculare pontaje pornita.');
  };

  const rebuildAllData = async () => {
    const confirmed = window.confirm(
      'Actiune critica: se sterg toate datele operationale (CV + pontaj) si se ruleaza reimport complet. Continui?'
    );

    if (!confirmed) {
      return;
    }

    await startBackgroundJob('/maintenance/rebuild-all', {}, 'Reset complet + reimport pornit.');
  };

  const formatCycleRange = (startedAt: string, endedAt: string): string =>
    `${formatDate(startedAt)} - ${formatDate(endedAt)}`;

  return (
    <section className="dashboard-page dashboard-futuristic">
      <div className="dashboard-section-heading">
        <h2>Dashboard</h2>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <div className="stats-grid dashboard-stats-grid dashboard-card-grid">
        <article className="stat-card dashboard-stat-card">
          <div className="dashboard-stat-icon">{renderIcon('people')}</div>
          <span>Angajati activi</span>
          <strong>{data?.totalActiveEmployees ?? '-'}</strong>
        </article>
        <article className="stat-card dashboard-stat-card">
          <div className="dashboard-stat-icon">{renderIcon('document')}</div>
          <span>CV-uri incomplete</span>
          <strong>{data?.totalIncompleteCvs ?? '-'}</strong>
        </article>
        <article className="stat-card dashboard-stat-card">
          <div className="dashboard-stat-icon">{renderIcon('clock')}</div>
          <span>Total ore ciclu curent</span>
          <strong>{data?.totalWeekLabel ?? '-'}</strong>
        </article>
        <article className="stat-card dashboard-stat-card">
          <div className="dashboard-stat-icon">{renderIcon('hash')}</div>
          <span>ID ciclu curent</span>
          <strong>{data?.currentCycleId ?? '-'}</strong>
        </article>
      </div>

      {canManage ? (
        <div className="card dashboard-panel dashboard-inactive-panel dashboard-card">
          <div className="dashboard-panel-header">
            <h3>Verificare Inactivi</h3>
          </div>
          <div className="filters dashboard-panel-actions">
            <button
              type="button"
              className="dashboard-primary-action"
              onClick={() => void loadInactiveReport()}
              disabled={inactiveLoading}
            >
              <span className="dashboard-action-icon">{renderIcon('search')}</span>
              <span>{inactiveLoading ? 'Se verifica...' : 'Verificare Inactivi'}</span>
            </button>
          </div>
          <p className="muted-line dashboard-panel-copy">
            Raportul verifica doar saptamanile inchise, de la data angajarii, si separa pontajele 0 min de cele sub 60 min.
          </p>
          {inactiveError ? <p className="error">{inactiveError}</p> : null}
          {inactiveReport ? (
            <>
              <div className="stats-grid dashboard-mini-stats">
                <article className="stat-card dashboard-mini-stat">
                  <div className="dashboard-mini-icon">{renderIcon('people')}</div>
                  <span>Angajati verificati</span>
                  <strong>{inactiveReport.totalEmployeesChecked}</strong>
                </article>
                <article className="stat-card dashboard-mini-stat">
                  <div className="dashboard-mini-icon">{renderIcon('calendar')}</div>
                  <span>Saptamani inchise</span>
                  <strong>{inactiveReport.totalCompletedCycles}</strong>
                </article>
                <article className="stat-card dashboard-mini-stat">
                  <div className="dashboard-mini-icon">{renderIcon('alert')}</div>
                  <span>Saptamani cu 0 min</span>
                  <strong>{inactiveReport.zeroMinuteWeeks}</strong>
                </article>
                <article className="stat-card dashboard-mini-stat">
                  <div className="dashboard-mini-icon">{renderIcon('pulse')}</div>
                  <span>Saptamani sub 60 min</span>
                  <strong>{inactiveReport.underSixtyMinuteWeeks}</strong>
                </article>
              </div>
              <p className="muted-line">Generat la: {formatDateTime(inactiveReport.generatedAt)}</p>

              <div className="card table-wrapper dashboard-subpanel">
                <h3>Fara pontaj</h3>
                {inactiveReport.zeroMinuteEmployees.length ? (
                  <table className="timesheet-table">
                    <thead>
                      <tr>
                        <th>Angajat</th>
                        <th>Rank</th>
                        <th>Intrat</th>
                        <th>Saptamani cu 0 min</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inactiveReport.zeroMinuteEmployees.map((employee) => (
                        <tr key={`zero-${employee.employeeId}`} className="is-inactive">
                          <td>
                            <strong>{employee.displayName}</strong>
                            <div className="muted-line">{employee.employeeCode ?? '-'}</div>
                          </td>
                          <td>{employee.rank ?? '-'}</td>
                          <td>{formatDate(employee.joinedAt)}</td>
                          <td>
                            <div className="inactive-report-weeks">
                              {employee.zeroWeeks.map((week) => (
                                <div key={`zero-${employee.employeeId}-${week.cycleId}`} className="inactive-report-week">
                                  <span className="badge danger">0 min</span>
                                  <span>{formatCycleRange(week.startedAt, week.endedAt)}</span>
                                  <span className="muted-line">Ciclu #{week.cycleId}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>Nu exista membri cu saptamani de 0 minute in ciclurile inchise.</p>
                )}
              </div>

              <div className="card table-wrapper dashboard-subpanel">
                <h3>Sub 60 minute</h3>
                {inactiveReport.underSixtyMinuteEmployees.length ? (
                  <table className="timesheet-table">
                    <thead>
                      <tr>
                        <th>Angajat</th>
                        <th>Rank</th>
                        <th>Intrat</th>
                        <th>Saptamani sub 60 min</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inactiveReport.underSixtyMinuteEmployees.map((employee) => (
                        <tr key={`low-${employee.employeeId}`}>
                          <td>
                            <strong>{employee.displayName}</strong>
                            <div className="muted-line">{employee.employeeCode ?? '-'}</div>
                          </td>
                          <td>{employee.rank ?? '-'}</td>
                          <td>{formatDate(employee.joinedAt)}</td>
                          <td>
                            <div className="inactive-report-weeks">
                              {employee.lowWeeks.map((week) => (
                                <div key={`low-${employee.employeeId}-${week.cycleId}`} className="inactive-report-week">
                                  <span className="badge warning">{week.totalLabel}</span>
                                  <span>{formatCycleRange(week.startedAt, week.endedAt)}</span>
                                  <span className="muted-line">Ciclu #{week.cycleId}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>Nu exista membri cu saptamani sub 60 minute in ciclurile inchise.</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <>
          <div className="card dashboard-panel dashboard-performance-panel dashboard-card">
            <div className="dashboard-panel-header">
              <h3>Performanta pontaje</h3>
            </div>
            <div className="stats-grid dashboard-mini-stats">
              <article className="stat-card dashboard-mini-stat">
                <div className="dashboard-mini-icon">{renderIcon('gauge')}</div>
                <span>Cache hit rate</span>
                <strong>{data?.timesheetPerformance ? `${data.timesheetPerformance.hitRate}%` : '-'}</strong>
              </article>
              <article className="stat-card dashboard-mini-stat">
                <div className="dashboard-mini-icon">{renderIcon('target')}</div>
                <span>Hit / Miss</span>
                <strong>
                  {data?.timesheetPerformance
                    ? `${data.timesheetPerformance.cacheHits}/${data.timesheetPerformance.cacheMisses}`
                    : '-'}
                </strong>
              </article>
              <article className="stat-card dashboard-mini-stat">
                <div className="dashboard-mini-icon">{renderIcon('pulse')}</div>
                <span>Timp mediu summary</span>
                <strong>{data?.timesheetPerformance ? `${data.timesheetPerformance.averageDurationMs} ms` : '-'}</strong>
              </article>
              <article className="stat-card dashboard-mini-stat">
                <div className="dashboard-mini-icon">{renderIcon('stack')}</div>
                <span>Intrari cache</span>
                <strong>{data?.timesheetPerformance?.cacheEntries ?? '-'}</strong>
              </article>
            </div>
          </div>

          <div className="card dashboard-panel dashboard-actions-panel dashboard-card action-panel">
            <div className="dashboard-panel-header">
              <h3>Actiuni rapide</h3>
            </div>
            <div className="filters dashboard-action-grid">
              <button type="button" className="btn-danger-action" onClick={() => void syncEmployeesIncremental()} disabled={maintenanceBusy}>
                <span className="dashboard-action-icon">{renderIcon('sync')}</span>
                <span>Sync incremental angajati</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
              <button type="button" className="btn-danger-action" onClick={() => void syncCurrentWeekTimesheets()} disabled={maintenanceBusy}>
                <span className="dashboard-action-icon">{renderIcon('calendar')}</span>
                <span>Sincronizeaza pontaj saptamana in curs</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
              <button type="button" className="btn-danger-action" onClick={() => void rebuildAllCvData()} disabled={maintenanceBusy}>
                <span className="dashboard-action-icon">{renderIcon('document')}</span>
                <span>Rebuild complet CV-uri</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
              <button type="button" className="btn-danger-action" onClick={() => void recalculateTimesheets()} disabled={maintenanceBusy}>
                <span className="dashboard-action-icon">{renderIcon('clock')}</span>
                <span>Recalculeaza timpii (toate saptamanile)</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
              <button type="button" className="btn-danger-action" onClick={() => void rebuildAllData()} disabled={maintenanceBusy}>
                <span className="dashboard-action-icon">{renderIcon('stack')}</span>
                <span>Reset complet + reimport</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
            </div>
            {jobStatus?.state === 'running' ? <p className="dashboard-job-line">Job in desfasurare: {jobStatus.type} (ID: {jobStatus.id})</p> : null}
            {jobStatus?.state === 'running' ? (
              <div className="dashboard-job-progress">
                <p>
                  Progres: {Math.round(displayedProgress)}% {jobStatus.progressMessage ? `- ${jobStatus.progressMessage}` : ''}
                </p>
                <progress value={displayedProgress} max={100} style={{ width: '100%' }} />
              </div>
            ) : null}
            {maintenanceMessage ? <p className="dashboard-job-line">{maintenanceMessage}</p> : null}
          </div>
        </>
      ) : (
        <div className="card dashboard-panel">
          <div className="dashboard-panel-header">
            <h3>Acces viewer</h3>
          </div>
          <p className="dashboard-panel-copy">Acest cont este read-only: poate vedea dashboard-ul, fara actiuni de modificare.</p>
        </div>
      )}
    </section>
  );
};

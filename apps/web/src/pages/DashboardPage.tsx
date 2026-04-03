import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import {
  DashboardResponse,
  MaintenanceJobStatus,
  MaintenanceStartResponse
} from '../types';

export const DashboardPage = () => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<MaintenanceJobStatus | null>(null);
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

  const pollJobStatus = async () => {
    try {
      const status = await apiGet<MaintenanceJobStatus>('/maintenance/job-status');
      setJobStatus(status);

      if (status.state === 'running') {
        pollTimerRef.current = window.setTimeout(() => {
          void pollJobStatus();
        }, 3000);
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
        setMaintenanceMessage(`Job eșuat: ${status.error ?? 'eroare necunoscută'}`);
      }
    } catch (pollError) {
      setMaintenanceBusy(false);
      setMaintenanceMessage(pollError instanceof Error ? pollError.message : 'Nu am putut citi statusul jobului.');
    }
  };

  const startBackgroundJob = async (endpoint: string, body: Record<string, unknown>, startedLabel: string) => {
    setMaintenanceBusy(true);
    setMaintenanceMessage(null);

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
    void pollJobStatus();

    return () => {
      stopPolling();
    };
  }, []);

  const syncEmployeesIncremental = async () => {
    await startBackgroundJob(
      '/maintenance/sync-employees-incremental',
      { lookbackDays: 14 },
      'Sync incremental angajati pornit.'
    );
  };

  const syncCurrentWeekTimesheets = async () => {
    await startBackgroundJob(
      '/maintenance/sync-timesheet-window',
      { days: 14 },
      'Sync pontaje saptamana in curs pornit.'
    );
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

  return (
    <section>
      <h2>Dashboard</h2>
      {error && <p className="error">{error}</p>}
      <div className="stats-grid">
        <article className="stat-card">
          <span>Angajati activi</span>
          <strong>{data?.totalActiveEmployees ?? '-'}</strong>
        </article>
        <article className="stat-card">
          <span>CV-uri incomplete</span>
          <strong>{data?.totalIncompleteCvs ?? '-'}</strong>
        </article>
        <article className="stat-card">
          <span>Total ore ciclu curent</span>
          <strong>{data?.totalWeekLabel ?? '-'}</strong>
        </article>
        <article className="stat-card">
          <span>ID ciclu curent</span>
          <strong>{data?.currentCycleId ?? '-'}</strong>
        </article>
      </div>

      <div className="card">
        <h3>Actiuni rapide</h3>
        <div className="filters">
          <button
            type="button"
            className="btn-danger-action"
            onClick={() => void syncEmployeesIncremental()}
            disabled={maintenanceBusy}
          >
            <span>Sync incremental angajati</span>
            <span className="warning-triangle" aria-hidden="true">
              <span>!</span>
            </span>
          </button>
          <button
            type="button"
            className="btn-danger-action"
            onClick={() => void syncCurrentWeekTimesheets()}
            disabled={maintenanceBusy}
          >
            <span>Sincronizeaza pontaj saptamana in curs</span>
            <span className="warning-triangle" aria-hidden="true">
              <span>!</span>
            </span>
          </button>
          <button type="button" className="btn-danger-action" onClick={() => void rebuildAllData()} disabled={maintenanceBusy}>
            <span>Reset complet + reimport</span>
            <span className="warning-triangle" aria-hidden="true">
              <span>!</span>
            </span>
          </button>
        </div>
        {jobStatus?.state === 'running' ? <p>Job in desfasurare: {jobStatus.type} (ID: {jobStatus.id})</p> : null}
        {jobStatus?.state === 'running' ? (
          <div>
            <p>
              Progres: {jobStatus.progressPercent ?? 0}% {jobStatus.progressMessage ? `- ${jobStatus.progressMessage}` : ''}
            </p>
            <progress value={jobStatus.progressPercent ?? 0} max={100} style={{ width: '100%' }} />
          </div>
        ) : null}
        {maintenanceMessage ? <p>{maintenanceMessage}</p> : null}
      </div>

      <div className="card">
        <h3>Top angajati dupa timp lucrat</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Angajat</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {data?.topEmployees.map((employee, index) => (
              <tr key={`${employee.displayName}-${index}`}>
                <td>{index + 1}</td>
                <td>{employee.displayName}</td>
                <td>{employee.totalLabel}</td>
              </tr>
            ))}
            {!data?.topEmployees?.length ? (
              <tr>
                <td colSpan={3}>Momentan nu exista date de pontaj in ciclul curent.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};

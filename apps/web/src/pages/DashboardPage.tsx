import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import {
  DashboardResponse,
  DeleteOldResponse,
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

  const deleteOldData = async () => {
    const confirmed = window.confirm(
      'Sigur vrei sa stergi datele mai vechi de 90 zile? Actiunea va elimina CV-uri si pontaje vechi.'
    );

    if (!confirmed) {
      return;
    }

    setMaintenanceBusy(true);
    setMaintenanceMessage(null);

    try {
      const result = await apiPost<DeleteOldResponse>('/maintenance/delete-old', { olderThanDays: 90 });
      setMaintenanceMessage(
        `Sterse: ${result.deleted.employees} angajati, ${result.deleted.timeEvents} evenimente, ${result.deleted.weekCycles} cicluri.`
      );
      await loadDashboard();
    } catch (actionError) {
      setMaintenanceMessage(actionError instanceof Error ? actionError.message : 'Nu am putut sterge datele vechi.');
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const syncNewResults = async () => {
    await startBackgroundJob('/maintenance/sync-new', { latestLimitPerChannel: 100 }, 'Rescan pornit.');
  };

  const syncLastTwoWeeksTimesheets = async () => {
    await startBackgroundJob('/maintenance/sync-timesheet-window', { days: 14 }, 'Sync pontaje 14 zile pornit.');
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
          <button type="button" onClick={() => void deleteOldData()} disabled={maintenanceBusy}>
            Sterge date vechi
          </button>
          <button type="button" onClick={() => void syncNewResults()} disabled={maintenanceBusy}>
            Cauta rezultate noi
          </button>
          <button type="button" onClick={() => void syncLastTwoWeeksTimesheets()} disabled={maintenanceBusy}>
            Sincronizeaza pontaje 14 zile
          </button>
          <button type="button" onClick={() => void rebuildAllData()} disabled={maintenanceBusy}>
            Reset complet + reimport
          </button>
        </div>
        {jobStatus?.state === 'running' ? <p>Job in desfasurare: {jobStatus.type} (ID: {jobStatus.id})</p> : null}
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

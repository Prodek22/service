import { useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../api/client';
import {
  DashboardResponse,
  MaintenanceJobStatus,
  MaintenanceStartResponse,
  ReactionTrackedMessage,
  ReactionTrackedMessagesResponse
} from '../types';

type DashboardPageProps = {
  canManage?: boolean;
};

export const DashboardPage = ({ canManage = false }: DashboardPageProps) => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<MaintenanceJobStatus | null>(null);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const [reactionTrackInput, setReactionTrackInput] = useState('');
  const [reactionTrackItems, setReactionTrackItems] = useState<ReactionTrackedMessage[]>([]);
  const [reactionTrackBusy, setReactionTrackBusy] = useState(false);
  const [reactionTrackMessage, setReactionTrackMessage] = useState<string | null>(null);
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

  const loadReactionTrackItems = async () => {
    if (!canManage) {
      return;
    }

    try {
      const response = await apiGet<ReactionTrackedMessagesResponse>('/maintenance/reaction-track-messages');
      setReactionTrackItems(response.items);
    } catch {
      // keep dashboard usable even if this call fails
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
    void loadReactionTrackItems();

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

  const addReactionTrackMessage = async () => {
    const messageId = reactionTrackInput.trim();
    if (!/^\d{8,30}$/.test(messageId)) {
      setReactionTrackMessage('Message ID invalid.');
      return;
    }

    setReactionTrackBusy(true);
    setReactionTrackMessage(null);

    try {
      const response = await apiPost<{ ok: boolean; items: ReactionTrackedMessage[] }>('/maintenance/reaction-track-messages', {
        messageId
      });
      setReactionTrackItems(response.items);
      setReactionTrackInput('');
      setReactionTrackMessage('Message ID salvat pentru monitorizare reactii.');
    } catch (saveError) {
      setReactionTrackMessage(saveError instanceof Error ? saveError.message : 'Nu am putut salva message ID.');
    } finally {
      setReactionTrackBusy(false);
    }
  };

  const removeReactionTrackMessage = async (messageId: string) => {
    setReactionTrackBusy(true);
    setReactionTrackMessage(null);

    try {
      const response = await apiDelete<{ ok: boolean; deleted: number; items: ReactionTrackedMessage[] }>(
        `/maintenance/reaction-track-messages/${messageId}`
      );
      setReactionTrackItems(response.items);
      setReactionTrackMessage('Message ID scos din monitorizare.');
    } catch (deleteError) {
      setReactionTrackMessage(deleteError instanceof Error ? deleteError.message : 'Nu am putut sterge message ID.');
    } finally {
      setReactionTrackBusy(false);
    }
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

      {canManage ? (
        <>
          <div className="card">
            <h3>Actiuni rapide</h3>
            <div className="filters">
              <button type="button" className="btn-danger-action" onClick={() => void syncEmployeesIncremental()} disabled={maintenanceBusy}>
                <span>Sync incremental angajati</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
              <button type="button" className="btn-danger-action" onClick={() => void syncCurrentWeekTimesheets()} disabled={maintenanceBusy}>
                <span>Sincronizeaza pontaj saptamana in curs</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
              <button type="button" className="btn-danger-action" onClick={() => void rebuildAllCvData()} disabled={maintenanceBusy}>
                <span>Rebuild complet CV-uri</span>
                <span className="warning-triangle" aria-hidden="true">
                  <span>!</span>
                </span>
              </button>
              <button type="button" className="btn-danger-action" onClick={() => void recalculateTimesheets()} disabled={maintenanceBusy}>
                <span>Recalculeaza timpii (toate saptamanile)</span>
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
                  Progres: {Math.round(displayedProgress)}% {jobStatus.progressMessage ? `- ${jobStatus.progressMessage}` : ''}
                </p>
                <progress value={displayedProgress} max={100} style={{ width: '100%' }} />
              </div>
            ) : null}
            {maintenanceMessage ? <p>{maintenanceMessage}</p> : null}
          </div>

          <div className="card">
            <h3>Monitorizare Reactii Discord</h3>
            <div className="filters">
              <input
                value={reactionTrackInput}
                onChange={(event) => setReactionTrackInput(event.target.value)}
                placeholder="Discord message ID"
                inputMode="numeric"
              />
              <button type="button" onClick={() => void addReactionTrackMessage()} disabled={reactionTrackBusy}>
                Adauga mesaj
              </button>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Message ID</th>
                    <th>Adaugat de</th>
                    <th>Creat la</th>
                    <th>Actiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {reactionTrackItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.messageId}</td>
                      <td>{item.createdBy ?? '-'}</td>
                      <td>{new Date(item.createdAt).toLocaleString('ro-RO')}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-pill btn-pill-danger"
                          onClick={() => void removeReactionTrackMessage(item.messageId)}
                          disabled={reactionTrackBusy}
                        >
                          Scoate
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!reactionTrackItems.length ? (
                    <tr>
                      <td colSpan={4}>Nu exista message ID-uri configurate pentru monitorizare reactii.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {reactionTrackMessage ? <p>{reactionTrackMessage}</p> : null}
          </div>
        </>
      ) : (
        <div className="card">
          <h3>Acces viewer</h3>
          <p>Acest cont este read-only: poate vedea dashboard-ul, fara actiuni de modificare.</p>
        </div>
      )}

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

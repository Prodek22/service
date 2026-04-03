import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { DashboardResponse, DeleteOldResponse, RebuildAllResponse, SyncNewResponse } from '../types';

export const DashboardPage = () => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  const loadDashboard = async () => {
    setError(null);
    setData(null);
    void apiGet<DashboardResponse>('/dashboard')
      .then(setData)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Eroare dashboard'));
  };

  useEffect(() => {
    void loadDashboard();
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
    setMaintenanceBusy(true);
    setMaintenanceMessage(null);

    try {
      const result = await apiPost<SyncNewResponse>('/maintenance/sync-new', { latestLimitPerChannel: 100 });
      setMaintenanceMessage(
        `Rescan finalizat. CV procesate: ${result.processed.cvProcessed}, pontaje procesate: ${result.processed.timesheetProcessed}.`
      );
      await loadDashboard();
    } catch (actionError) {
      setMaintenanceMessage(actionError instanceof Error ? actionError.message : 'Nu am putut cauta rezultate noi.');
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const rebuildAllData = async () => {
    const confirmed = window.confirm(
      'Actiune critica: se sterg toate datele operationale (CV + pontaj) si se ruleaza reimport complet. Continui?'
    );

    if (!confirmed) {
      return;
    }

    setMaintenanceBusy(true);
    setMaintenanceMessage(null);

    try {
      const result = await apiPost<RebuildAllResponse>('/maintenance/rebuild-all', {});
      setMaintenanceMessage(
        `Reset complet finalizat. Reimportat: ${result.processed.cvProcessed} CV, ${result.processed.timesheetProcessed} pontaje.`
      );
      await loadDashboard();
    } catch (actionError) {
      setMaintenanceMessage(actionError instanceof Error ? actionError.message : 'Nu am putut executa resetul complet.');
    } finally {
      setMaintenanceBusy(false);
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

      <div className="card">
        <h3>Actiuni rapide</h3>
        <div className="filters">
          <button type="button" onClick={() => void deleteOldData()} disabled={maintenanceBusy}>
            Sterge date vechi
          </button>
          <button type="button" onClick={() => void syncNewResults()} disabled={maintenanceBusy}>
            Cauta rezultate noi
          </button>
          <button type="button" onClick={() => void rebuildAllData()} disabled={maintenanceBusy}>
            Reset complet + reimport
          </button>
        </div>
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

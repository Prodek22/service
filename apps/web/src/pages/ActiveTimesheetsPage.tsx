import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api/client';
import { ActiveTimesheetsResponse } from '../types';
import { formatDateTime } from '../utils/format';

const formatElapsed = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }

  return `${minutes}m ${secs}s`;
};

export const ActiveTimesheetsPage = () => {
  const [data, setData] = useState<ActiveTimesheetsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<ActiveTimesheetsResponse>('/timesheet/active?hours=24');
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca pontajele active.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }

    const timer = window.setInterval(() => {
      void load();
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshEnabled]);

  const activeCount = useMemo(() => data?.items.length ?? 0, [data]);

  return (
    <section>
      <h2>Pontaje Active</h2>

      <div className="card filters">
        <span>
          In desfasurare acum: <strong>{activeCount}</strong>
        </span>
        <span>
          Fereastra: <strong>{data?.hoursWindow ?? 24}h</strong>
        </span>
        <button type="button" onClick={() => setAutoRefreshEnabled((current) => !current)}>
          Live: {autoRefreshEnabled ? 'ON (30s)' : 'OFF'}
        </button>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Actualizare...' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="card table-wrapper">
        <table className="timesheet-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nickname</th>
              <th>Rank</th>
              <th>Service</th>
              <th>Inceput</th>
              <th>Timp in desfasurare</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr key={item.key}>
                <td>{item.employeeCode ?? '-'}</td>
                <td>
                  <div className="timesheet-user-cell">
                    {item.avatarUrl ? (
                      <img className="timesheet-avatar" src={item.avatarUrl} alt={item.displayName} loading="lazy" referrerPolicy="no-referrer" />
                    ) : null}
                    <span>{item.displayName}</span>
                  </div>
                </td>
                <td>{item.rank ?? '-'}</td>
                <td>{item.serviceCode}</td>
                <td>{formatDateTime(item.startedAt)}</td>
                <td>
                  <strong>{formatElapsed(item.elapsedSeconds)}</strong>
                </td>
              </tr>
            ))}
            {!loading && !(data?.items ?? []).length ? (
              <tr>
                <td colSpan={6}>Nu exista pontaje active in ultimele 24 ore.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};

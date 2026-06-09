import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { StationFrequencyLog, StationFrequencyLogsResponse } from '../types';
import { formatDateTime } from '../utils/format';

export const StationFrequencyLogsPage = () => {
  const [items, setItems] = useState<StationFrequencyLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<StationFrequencyLogsResponse>('/station-frequency/logs?limit=150');
      setItems(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca logurile de statie.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="station-frequency-logs-page">
      <div className="section-heading-row">
        <div>
          <h2>Log schimbari statii</h2>
          <p>Ultimele frecvente generate si persoana care a schimbat statia.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Se incarca...' : 'Reincarca'}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="card table-wrapper">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Canal</th>
              <th>User Discord</th>
              <th>ID Discord</th>
              <th>Statie veche</th>
              <th>Statie noua</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.changedAt)}</td>
                <td>
                  <code>{item.channelId}</code>
                </td>
                <td>{item.userDisplayName ?? '-'}</td>
                <td>
                  <code>{item.discordUserId}</code>
                </td>
                <td>{item.oldFrequency ?? '-'}</td>
                <td>
                  <strong>{item.newFrequency}</strong>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={6}>Nu exista schimbari de statie logate inca.</td>
              </tr>
            ) : null}
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={6}>Se incarca logurile...</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};

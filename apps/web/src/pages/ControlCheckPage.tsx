import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { ControlCheckLog, ControlCheckLogsResponse } from '../types';
import { formatDateTime } from '../utils/format';

export const ControlCheckPage = () => {
  const [items, setItems] = useState<ControlCheckLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<ControlCheckLogsResponse>('/control-check?limit=150');
      setItems(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca lista controalelor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="control-check-page">
      <div className="section-heading-row">
        <div>
          <h2>Control service</h2>
          <p>Istoric complet cu fiecare apasare a butonului Discord.</p>
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
              <th>#</th>
              <th>Data si ora</th>
              <th>Cine a apasat</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td>{index + 1}</td>
                <td>{formatDateTime(item.checkedAt)}</td>
                <td>
                  <strong>{item.userDisplayName ?? 'utilizator necunoscut'}</strong>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={3}>Nu exista controale inregistrate inca.</td>
              </tr>
            ) : null}
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={3}>Se incarca lista controalelor...</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};

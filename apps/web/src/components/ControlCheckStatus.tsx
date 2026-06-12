import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { ControlCheckLatestResponse } from '../types';
import { formatDateTime } from '../utils/format';

export const ControlCheckStatus = () => {
  const [data, setData] = useState<ControlCheckLatestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      void apiGet<ControlCheckLatestResponse>('/control-check/latest')
        .then((response) => {
          setData(response);
          setError(null);
        })
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca statusul controlului.');
        });
    };

    load();
    const timer = window.setInterval(load, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  if (error) {
    return null;
  }

  const latest = data?.latest ?? null;

  return (
    <section className="control-check-status card" aria-label="Status control service">
      <span className="control-check-status-label">Control service</span>
      {latest ? (
        <p>
          Controlul a fost facut la {formatDateTime(latest.checkedAt)} -{' '}
          <strong>{latest.userDisplayName ?? 'utilizator necunoscut'}</strong>
        </p>
      ) : (
        <p>Controlul nu a fost inregistrat inca.</p>
      )}
    </section>
  );
};

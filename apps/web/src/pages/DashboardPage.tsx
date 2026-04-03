import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { DashboardResponse } from '../types';

export const DashboardPage = () => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<DashboardResponse>('/dashboard')
      .then(setData)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Eroare dashboard'));
  }, []);

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

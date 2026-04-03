import { useEffect, useMemo, useState } from 'react';
import { apiBaseUrl, apiGet } from '../api/client';
import { TimeEventHistoryResponse, TimesheetSummaryResponse, WeekCycle } from '../types';
import { formatCurrency, formatDateTime, formatMinutes } from '../utils/format';

export const TimesheetPage = () => {
  const [cycles, setCycles] = useState<WeekCycle[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [summary, setSummary] = useState<TimesheetSummaryResponse | null>(null);

  const [historyTitle, setHistoryTitle] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<TimeEventHistoryResponse['history']>([]);

  useEffect(() => {
    void apiGet<WeekCycle[]>('/timesheet/cycles').then((response) => {
      setCycles(response);
      setSelectedCycleId((current) => current ?? response[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!selectedCycleId) {
      return;
    }

    void apiGet<TimesheetSummaryResponse>(`/timesheet/summary?cycleId=${selectedCycleId}`).then(setSummary);
  }, [selectedCycleId]);

  const exportLink = useMemo(() => {
    if (!selectedCycleId) {
      return '#';
    }

    return `${apiBaseUrl}/timesheet/export.csv?cycleId=${selectedCycleId}`;
  }, [selectedCycleId]);

  const openHistory = async (employeeId: number | null, label: string) => {
    if (!employeeId || !selectedCycleId) {
      return;
    }

    const response = await apiGet<TimeEventHistoryResponse>(
      `/timesheet/employee/${employeeId}/history?cycleId=${selectedCycleId}`
    );

    setHistoryTitle(label);
    setHistoryRows(response.history);
  };

  return (
    <section>
      <h2>Pontaj saptamanal</h2>

      <div className="card filters">
        <select
          value={selectedCycleId ?? ''}
          onChange={(event) => setSelectedCycleId(Number.parseInt(event.target.value, 10) || null)}
        >
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              Ciclu #{cycle.id} - {cycle.serviceCode} ({formatDateTime(cycle.startedAt)} {'->'}{' '}
              {cycle.endedAt ? formatDateTime(cycle.endedAt) : 'Prezent'})
            </option>
          ))}
          {!cycles.length && <option value="">Nu exista cicluri</option>}
        </select>
        <a href={exportLink}>Export CSV</a>
      </div>

      <div className="card table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nickname</th>
              <th>Rank</th>
              <th>Total timp (min)</th>
              <th>Timp normal (min)</th>
              <th>Ajustari manuale (min)</th>
              <th>+ Ajustari (min)</th>
              <th>- Ajustari (min)</th>
              <th>Nr ajustari</th>
              <th>Salariu</th>
              <th>Istoric</th>
            </tr>
          </thead>
          <tbody>
            {summary?.totals.map((row) => (
              <tr key={row.key}>
                <td>{row.employeeCode ?? '-'}</td>
                <td>{row.displayName}</td>
                <td>{row.rank ?? '-'}</td>
                <td>{formatMinutes(row.totalSeconds)}</td>
                <td>{formatMinutes(row.normalSeconds)}</td>
                <td>{formatMinutes(row.manualAdjustmentSeconds)}</td>
                <td>{formatMinutes(row.positiveAdjustmentSeconds)}</td>
                <td>{formatMinutes(Math.abs(row.negativeAdjustmentSeconds))}</td>
                <td>{row.manualAdjustmentsCount}</td>
                <td title={`Baza: ${formatCurrency(row.baseSalary)} | Bonus top: ${formatCurrency(row.topBonus)}`}>
                  {formatCurrency(row.salaryTotal)}
                </td>
                <td>
                  <button
                    className="btn-history"
                    onClick={() => void openHistory(row.employeeId, row.displayName)}
                    disabled={!row.employeeId}
                  >
                    Vezi evenimente
                  </button>
                </td>
              </tr>
            ))}
            {!summary?.totals.length ? (
              <tr>
                <td colSpan={11}>Nu exista pontaje in ciclul selectat.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {historyTitle ? (
        <div className="modal-backdrop">
          <div className="modal large">
            <h3>Istoric complet: {historyTitle}</h3>
            <div className="raw-list">
              {historyRows.map((event) => (
                <article key={event.id} className="raw-item">
                  <header>
                    <strong>{event.eventType}</strong>
                    <span>{formatDateTime(event.eventAt)}</span>
                  </header>
                  <p>
                    Delta: <strong>{event.deltaSeconds ?? 0}</strong> sec | Service: {event.serviceCode ?? '-'}
                  </p>
                  <pre>{event.rawText}</pre>
                </article>
              ))}
              {!historyRows.length && <p>Nu exista evenimente in acest ciclu pentru angajat.</p>}
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setHistoryTitle(null);
                  setHistoryRows([]);
                }}
              >
                Inchide
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

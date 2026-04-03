import { useEffect, useMemo, useState } from 'react';
import { apiBaseUrl, apiGet, apiPost } from '../api/client';
import { TimeEventHistoryResponse, TimesheetSummaryResponse, WeekCycle } from '../types';
import { formatCurrency, formatDateTime, formatMinutes } from '../utils/format';

type TimesheetPageProps = {
  readOnly?: boolean;
};

export const TimesheetPage = ({ readOnly = false }: TimesheetPageProps) => {
  const [cycles, setCycles] = useState<WeekCycle[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [summary, setSummary] = useState<TimesheetSummaryResponse | null>(null);
  const [payrollBusyByEmployee, setPayrollBusyByEmployee] = useState<Record<number, boolean>>({});

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

  const getTotalAdjustmentsSeconds = (row: TimesheetSummaryResponse['totals'][number]) =>
    row.positiveAdjustmentSeconds + Math.abs(row.negativeAdjustmentSeconds);

  const getInitials = (label: string) =>
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U';

  const getAvatarFallback = (label: string) => {
    const initials = getInitials(label);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='32' fill='#2f2c4d'/><text x='50%' y='52%' text-anchor='middle' dominant-baseline='middle' font-family='Segoe UI, Arial' font-size='24' fill='#ffffff' font-weight='700'>${initials}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const getAvatarUrl = (row: TimesheetSummaryResponse['totals'][number]) => row.avatarUrl ?? getAvatarFallback(row.displayName);

  const togglePayrollStatus = async (employeeId: number | null, isPaid: boolean) => {
    if (readOnly || !employeeId || !selectedCycleId || !summary) {
      return;
    }

    setPayrollBusyByEmployee((current) => ({ ...current, [employeeId]: true }));

    const previous = summary;
    const optimistic: TimesheetSummaryResponse = {
      ...previous,
      totals: previous.totals.map((row) =>
        row.employeeId === employeeId
          ? {
              ...row,
              payroll: {
                ...row.payroll,
                isPaid
              }
            }
          : row
      )
    };
    setSummary(optimistic);

    try {
      const response = await apiPost<{
        ok: boolean;
        payroll: { isPaid: boolean; paidAt: string | null; paidBy: string | null; note: string | null };
      }>('/timesheet/payroll-status', {
        cycleId: selectedCycleId,
        employeeId,
        isPaid
      });

      setSummary((current) =>
        current
          ? {
              ...current,
              totals: current.totals.map((row) =>
                row.employeeId === employeeId
                  ? {
                      ...row,
                      payroll: response.payroll
                    }
                  : row
              )
            }
          : current
      );
    } catch {
      setSummary(previous);
    } finally {
      setPayrollBusyByEmployee((current) => ({ ...current, [employeeId]: false }));
    }
  };

  return (
    <section>
      <h2>Pontaj saptamanal</h2>

      <div className="card filters">
        <select
          className="cycle-select"
          value={selectedCycleId ?? ''}
          onChange={(event) => setSelectedCycleId(Number.parseInt(event.target.value, 10) || null)}
        >
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {formatDateTime(cycle.startedAt)} {'->'} {cycle.endedAt ? formatDateTime(cycle.endedAt) : 'Prezent'}
            </option>
          ))}
          {!cycles.length && <option value="">Nu exista cicluri</option>}
        </select>
        <a href={exportLink}>Export CSV</a>
      </div>

      <div className="card table-wrapper timesheet-table-wrap">
        <table className="timesheet-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nickname</th>
              <th>Rank</th>
              <th>Total timp (min)</th>
              <th>Total ajustari (min)</th>
              <th>Salariu</th>
              <th>Platit</th>
              <th>Istoric</th>
            </tr>
          </thead>
          <tbody>
            {summary?.totals.map((row) => (
              <tr key={row.key} className={row.payroll.isPaid ? 'is-paid' : undefined}>
                <td>{row.employeeCode ?? '-'}</td>
                <td>
                  {readOnly ? (
                    <div className="timesheet-user-cell">
                      <img
                        className="timesheet-avatar"
                        src={getAvatarUrl(row)}
                        alt={row.displayName}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          const target = event.currentTarget;
                          if (target.dataset.fallbackApplied === 'true') {
                            return;
                          }

                          target.dataset.fallbackApplied = 'true';
                          target.src = getAvatarFallback(row.displayName);
                        }}
                      />
                      <span>{row.displayName}</span>
                    </div>
                  ) : (
                    row.displayName
                  )}
                </td>
                <td>{row.rank ?? '-'}</td>
                <td>{formatMinutes(row.totalSeconds)}</td>
                <td
                  title={`+ Ajustari: ${formatMinutes(row.positiveAdjustmentSeconds)} | - Ajustari: ${formatMinutes(
                    Math.abs(row.negativeAdjustmentSeconds)
                  )}`}
                >
                  {formatMinutes(getTotalAdjustmentsSeconds(row))}
                </td>
                <td title={`Baza: ${formatCurrency(row.baseSalary)} | Bonus top: ${formatCurrency(row.topBonus)}`}>
                  {formatCurrency(row.salaryTotal)}
                </td>
                <td>
                  {readOnly ? (
                    <span className={`badge ${row.payroll.isPaid ? 'ok' : 'muted'}`}>{row.payroll.isPaid ? 'DA' : 'NU'}</span>
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={row.payroll.isPaid}
                        disabled={!row.employeeId || Boolean(row.employeeId && payrollBusyByEmployee[row.employeeId])}
                        onChange={(event) => void togglePayrollStatus(row.employeeId, event.target.checked)}
                      />{' '}
                      {row.payroll.isPaid ? 'DA' : 'NU'}
                    </label>
                  )}
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
                <td colSpan={8}>Nu exista pontaje in ciclul selectat.</td>
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

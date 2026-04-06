import { useEffect, useMemo, useState } from 'react';
import { apiBaseUrl, apiGet, apiPost } from '../api/client';
import { TimeEventHistoryResponse, TimesheetSummaryResponse, WeekCycle } from '../types';
import { formatCurrency, formatDate, formatDateTime, formatMinutes } from '../utils/format';

type TimesheetPageProps = {
  readOnly?: boolean;
};

export const TimesheetPage = ({ readOnly = false }: TimesheetPageProps) => {
  type SortBy = 'total' | 'rank' | 'entryDate';
  type SortDir = 'asc' | 'desc';

  const [cycles, setCycles] = useState<WeekCycle[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [summary, setSummary] = useState<TimesheetSummaryResponse | null>(null);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [payrollBusyByEmployee, setPayrollBusyByEmployee] = useState<Record<number, boolean>>({});
  const [upBusyByEmployee, setUpBusyByEmployee] = useState<Record<number, boolean>>({});

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

  const visibleRows = useMemo(() => {
    const rows = summary?.totals ?? [];
    const filtered = inactiveOnly ? rows.filter((row) => row.inactiveLast3Weeks) : rows;

    const rankValue = (rank: string | null): number => {
      const normalized = (rank ?? '').trim().toLowerCase();
      if (normalized === 'mecanic-senior' || normalized === 'mecanic senior') return 4;
      if (normalized === 'mecanic') return 3;
      if (
        normalized === 'mecani-junior' ||
        normalized === 'mecani junior' ||
        normalized === 'mecanic-junior' ||
        normalized === 'mecanic junior'
      ) {
        return 2;
      }
      if (normalized === 'ucenic') return 1;
      return 0;
    };

    const sorted = [...filtered].sort((a, b) => {
      let delta = 0;

      if (sortBy === 'rank') {
        delta = rankValue(a.rank) - rankValue(b.rank);
      } else if (sortBy === 'entryDate') {
        const aTime = a.entryDate ? new Date(a.entryDate).getTime() : 0;
        const bTime = b.entryDate ? new Date(b.entryDate).getTime() : 0;
        delta = aTime - bTime;
      } else {
        delta = a.totalSeconds - b.totalSeconds;
      }

      if (delta === 0) {
        delta = a.displayName.localeCompare(b.displayName, 'ro');
      }

      return sortDir === 'asc' ? delta : -delta;
    });

    return sorted;
  }, [summary, inactiveOnly, sortBy, sortDir]);

  const cycleSalaryTotal = useMemo(
    () => (summary?.totals ?? []).reduce((sum, row) => sum + row.salaryTotal, 0),
    [summary]
  );

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
        payroll: { isPaid: boolean; isUp: boolean; paidAt: string | null; paidBy: string | null; note: string | null };
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

  const toggleUpStatus = async (employeeId: number | null, isUp: boolean) => {
    if (readOnly || !employeeId || !selectedCycleId || !summary) {
      return;
    }

    setUpBusyByEmployee((current) => ({ ...current, [employeeId]: true }));

    const previous = summary;
    const optimistic: TimesheetSummaryResponse = {
      ...previous,
      totals: previous.totals.map((row) =>
        row.employeeId === employeeId
          ? {
              ...row,
              payroll: {
                ...row.payroll,
                isUp
              }
            }
          : row
      )
    };
    setSummary(optimistic);

    try {
      const response = await apiPost<{
        ok: boolean;
        payroll: { isPaid: boolean; isUp: boolean; paidAt: string | null; paidBy: string | null; note: string | null };
      }>('/timesheet/up-status', {
        cycleId: selectedCycleId,
        employeeId,
        isUp
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
      setUpBusyByEmployee((current) => ({ ...current, [employeeId]: false }));
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
        {!readOnly ? <a href={exportLink}>Export CSV</a> : null}
        {!readOnly ? (
          <div className="timesheet-week-salary-total">
            Total salarii ciclu: <strong>{formatCurrency(cycleSalaryTotal)}</strong>
          </div>
        ) : null}
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
          <option value="total">Sortare: Total timp</option>
          <option value="rank">Sortare: Rank</option>
          <option value="entryDate">Sortare: Data intrare</option>
        </select>
        <button type="button" onClick={() => setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))}>
          Directie: {sortDir === 'asc' ? 'Asc' : 'Desc'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={inactiveOnly}
            onChange={(event) => setInactiveOnly(event.target.checked)}
          />
          Doar inactivi (0 in ultimele 3)
        </label>
      </div>

      <div className="card table-wrapper timesheet-table-wrap">
        <table className="timesheet-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nickname</th>
              <th>Rank</th>
              <th>Data intrare</th>
              <th>Total timp (min)</th>
              <th>Total ajustari (min)</th>
              <th>Salariu</th>
              <th>Platit</th>
              <th>Up</th>
              <th>Istoric</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.key}
                className={[
                  row.payroll.isPaid ? 'is-paid' : '',
                  row.inactiveLast3Weeks ? 'is-inactive' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
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
                      {row.inactiveLast3Weeks ? (
                        <span className="badge danger" title="Pontaj 0 in ultimele 3 saptamani complete">
                          0 in ultimele 3
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      {row.displayName}
                      {row.inactiveLast3Weeks ? (
                        <span className="badge danger" title="Pontaj 0 in ultimele 3 saptamani complete">
                          0 in ultimele 3
                        </span>
                      ) : null}
                    </>
                  )}
                </td>
                <td>{row.rank ?? '-'}</td>
                <td>{formatDate(row.entryDate)}</td>
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
                  {readOnly ? (
                    <span className={`badge ${row.payroll.isUp ? 'ok' : 'muted'}`}>{row.payroll.isUp ? 'DA' : 'NU'}</span>
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={row.payroll.isUp}
                        disabled={!row.employeeId || Boolean(row.employeeId && upBusyByEmployee[row.employeeId])}
                        onChange={(event) => void toggleUpStatus(row.employeeId, event.target.checked)}
                      />{' '}
                      {row.payroll.isUp ? 'DA' : 'NU'}
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
            {!visibleRows.length ? (
              <tr>
                <td colSpan={10}>
                  {inactiveOnly
                    ? 'Nu exista angajati marcati ca inactivi pentru acest ciclu.'
                    : 'Nu exista pontaje in ciclul selectat.'}
                </td>
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

import { useEffect, useMemo, useState } from 'react';
import { apiBaseUrl, apiGet, apiPost } from '../api/client';
import { TimeEventHistoryResponse, TimesheetSummaryResponse, WeekCycle } from '../types';
import { formatCurrency, formatDate, formatDateTime, formatMinutes } from '../utils/format';

type TimesheetPageProps = {
  readOnly?: boolean;
};

const normalizeSearch = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

export const TimesheetPage = ({ readOnly = false }: TimesheetPageProps) => {
  type SortBy = 'total' | 'rank' | 'entryDate';
  type SortDir = 'asc' | 'desc';
  type UpRequirement = {
    requiredMonths: number;
    nextLabel: string;
    colorClass: 'up-next-junior' | 'up-next-mecanic' | 'up-next-senior' | 'up-next-management';
  };

  const [cycles, setCycles] = useState<WeekCycle[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [summary, setSummary] = useState<TimesheetSummaryResponse | null>(null);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [payrollBusyByEmployee, setPayrollBusyByEmployee] = useState<Record<number, boolean>>({});
  const [upBusyByEmployee, setUpBusyByEmployee] = useState<Record<number, boolean>>({});
  const [monthsBusyByEmployee, setMonthsBusyByEmployee] = useState<Record<number, boolean>>({});

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
    const normalizedQuery = normalizeSearch(searchQuery);

    const searchableRows = normalizedQuery
      ? filtered.filter((row) => {
          const rowText = [
            row.employeeCode ?? '',
            row.displayName ?? '',
            row.rank ?? '',
            row.monthsInCity != null ? String(row.monthsInCity) : '',
            row.entryDate ?? '',
            formatDate(row.entryDate),
            row.discordUserId ?? '',
            String(row.totalSeconds),
            formatMinutes(row.totalSeconds),
            String(row.normalSeconds),
            String(row.manualAdjustmentSeconds),
            String(row.positiveAdjustmentSeconds),
            String(row.negativeAdjustmentSeconds),
            String(row.manualAdjustmentsCount),
            String(row.eventsCount),
            String(row.baseSalary),
            String(row.topBonus),
            String(row.salaryTotal),
            formatCurrency(row.salaryTotal),
            row.payroll.isPaid ? 'platit da paid yes' : 'platit nu unpaid no',
            row.payroll.isUp ? 'up da yes' : 'up nu no'
          ]
            .join(' ')
            .replace(/\s+/g, ' ');

          return normalizeSearch(rowText).includes(normalizedQuery);
        })
      : filtered;

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

    const sorted = [...searchableRows].sort((a, b) => {
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
  }, [summary, inactiveOnly, searchQuery, sortBy, sortDir]);

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

  const getUpRequirement = (rank: string | null): UpRequirement | null => {
    const normalized = (rank ?? '').trim().toLowerCase();

    if (normalized === 'ucenic') {
      return { requiredMonths: 100, nextLabel: 'Mecanic-Junior', colorClass: 'up-next-junior' };
    }

    if (
      normalized === 'mecani-junior' ||
      normalized === 'mecani junior' ||
      normalized === 'mecanic-junior' ||
      normalized === 'mecanic junior'
    ) {
      return { requiredMonths: 150, nextLabel: 'Mecanic', colorClass: 'up-next-mecanic' };
    }

    if (normalized === 'mecanic') {
      return { requiredMonths: 200, nextLabel: 'Mecanic-Senior', colorClass: 'up-next-senior' };
    }

    if (normalized === 'mecanic-senior' || normalized === 'mecanic senior') {
      return { requiredMonths: 250, nextLabel: 'Conducere', colorClass: 'up-next-management' };
    }

    return null;
  };

  const getUpVisualState = (row: TimesheetSummaryResponse['totals'][number]) => {
    const requirement = getUpRequirement(row.rank);
    if (!requirement) {
      return {
        isEligible: false,
        colorClass: '',
        title: 'Rank fara regula de UP configurata.'
      };
    }

    const hasMinutes = row.totalSeconds >= 420 * 60;
    const months = row.monthsInCity ?? 0;
    const hasMonths = months >= requirement.requiredMonths;
    const isEligible = hasMinutes && hasMonths;
    const title = isEligible
      ? `Eligibil UP: ${requirement.nextLabel} (>= 420 min, >= ${requirement.requiredMonths} luni).`
      : `Neeligibil UP: ${months}/${requirement.requiredMonths} luni, ${formatMinutes(row.totalSeconds)} / 420 min.`;

    return {
      isEligible,
      colorClass: isEligible ? requirement.colorClass : '',
      title
    };
  };

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

  const updateMonthsSnapshot = async (employeeId: number | null, currentMonths: number | null) => {
    if (readOnly || !employeeId || !selectedCycleId || !summary) {
      return;
    }

    const answer = window.prompt('Seteaza luni pentru ciclul selectat:', String(currentMonths ?? 0));
    if (answer == null) {
      return;
    }

    const parsed = Number.parseInt(answer.trim(), 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 10000) {
      window.alert('Valoare invalida. Introdu un numar intre 0 si 10000.');
      return;
    }

    setMonthsBusyByEmployee((current) => ({ ...current, [employeeId]: true }));
    const previous = summary;
    const optimistic: TimesheetSummaryResponse = {
      ...previous,
      totals: previous.totals.map((row) =>
        row.employeeId === employeeId
          ? {
              ...row,
              monthsInCity: parsed
            }
          : row
      )
    };
    setSummary(optimistic);

    try {
      await apiPost<{
        ok: boolean;
        payroll: {
          isPaid: boolean;
          isUp: boolean;
          monthsInCity: number;
          paidAt: string | null;
          paidBy: string | null;
          note: string | null;
        };
      }>('/timesheet/months-status', {
        cycleId: selectedCycleId,
        employeeId,
        monthsInCity: parsed
      });
    } catch {
      setSummary(previous);
    } finally {
      setMonthsBusyByEmployee((current) => ({ ...current, [employeeId]: false }));
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
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Cautare globala: id, nume, rank, luni, data, minute, salariu, platit, up..."
        />
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
              <th>Luni</th>
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
            {visibleRows.map((row) => {
              const upState = getUpVisualState(row);
              return (
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
                <td>
                  {readOnly ? (
                    row.monthsInCity ?? '-'
                  ) : (
                    <div className="timesheet-months-cell">
                      <span>{row.monthsInCity ?? '-'}</span>
                      <button
                        type="button"
                        className="btn-inline-edit"
                        disabled={!row.employeeId || Boolean(row.employeeId && monthsBusyByEmployee[row.employeeId])}
                        onClick={() => void updateMonthsSnapshot(row.employeeId, row.monthsInCity)}
                      >
                        Editeaza
                      </button>
                    </div>
                  )}
                </td>
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
                <td
                  className={`up-cell ${upState.colorClass}`.trim()}
                  title={upState.title}
                >
                  {readOnly ? (
                    <span className={`badge ${row.payroll.isUp ? 'ok' : 'muted'} ${upState.colorClass}`.trim()}>
                      {row.payroll.isUp ? 'DA' : 'NU'}
                    </span>
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
              );
            })}
            {!visibleRows.length ? (
              <tr>
                <td colSpan={11}>
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

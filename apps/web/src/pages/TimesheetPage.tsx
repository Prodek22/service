import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl, apiGet, apiPost } from '../api/client';
import { EmployeeRankHistoryResponse, TimeEventHistoryResponse, TimesheetSummaryResponse, WeekCycle } from '../types';
import { formatCurrency, formatDate, formatDateTime, formatMinutes } from '../utils/format';

type TimesheetPageProps = {
  readOnly?: boolean;
};

type SummaryCacheEntry = {
  data: TimesheetSummaryResponse;
  fetchedAt: number;
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
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [payrollBusyByEmployee, setPayrollBusyByEmployee] = useState<Record<number, boolean>>({});
  const [upBusyByEmployee, setUpBusyByEmployee] = useState<Record<number, boolean>>({});
  const [monthsBusyByEmployee, setMonthsBusyByEmployee] = useState<Record<number, boolean>>({});
  const [historyModalTitle, setHistoryModalTitle] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<'events' | 'rank'>('events');
  const [historyRows, setHistoryRows] = useState<TimeEventHistoryResponse['history']>([]);
  const [rankHistoryRows, setRankHistoryRows] = useState<EmployeeRankHistoryResponse['history']>([]);
  const summaryCacheRef = useRef<Record<number, SummaryCacheEntry>>({});
  const summaryRequestSeqRef = useRef(0);

  useEffect(() => {
    void apiGet<WeekCycle[]>('/timesheet/cycles').then((response) => {
      setCycles(response);
      setSelectedCycleId((current) => current ?? response[0]?.id ?? null);
    });
  }, []);

  const getSummaryTtlMs = useCallback(
    (cycleId: number): number => {
      const cycle = cycles.find((item) => item.id === cycleId);
      return cycle?.endedAt ? 24 * 60 * 60 * 1000 : 20 * 1000;
    },
    [cycles]
  );

  const fetchSummary = useCallback(
    async (cycleId: number, options?: { background?: boolean; force?: boolean }) => {
      const cached = summaryCacheRef.current[cycleId];
      const ttlMs = getSummaryTtlMs(cycleId);
      const isFresh = cached ? Date.now() - cached.fetchedAt < ttlMs : false;

      if (cached && selectedCycleId === cycleId) {
        setSummary(cached.data);
      }

      if (cached && isFresh && !options?.force) {
        return cached.data;
      }

      if (!options?.background) {
        setSummaryLoading(true);
      }

      try {
        const data = await apiGet<TimesheetSummaryResponse>(`/timesheet/summary?cycleId=${cycleId}`);
        summaryCacheRef.current[cycleId] = {
          data,
          fetchedAt: Date.now()
        };

        if (selectedCycleId === cycleId) {
          setSummary(data);
        }

        return data;
      } finally {
        if (!options?.background) {
          setSummaryLoading(false);
        }
      }
    },
    [getSummaryTtlMs, selectedCycleId]
  );

  useEffect(() => {
    if (!selectedCycleId) {
      return;
    }

    const requestSeq = ++summaryRequestSeqRef.current;
    const cached = summaryCacheRef.current[selectedCycleId];
    if (cached) {
      setSummary(cached.data);
    }

    void fetchSummary(selectedCycleId, {
      background: Boolean(cached),
      force: true
    }).then((data) => {
      if (!data || requestSeq !== summaryRequestSeqRef.current) {
        return;
      }

      setSummary(data);
    });
  }, [fetchSummary, selectedCycleId]);

  useEffect(() => {
    const idsToPrefetch = cycles
      .map((cycle) => cycle.id)
      .filter((cycleId) => cycleId !== selectedCycleId && !summaryCacheRef.current[cycleId]);

    if (!idsToPrefetch.length) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const cycleId of idsToPrefetch) {
        if (cancelled) {
          break;
        }

        try {
          await fetchSummary(cycleId, { background: true });
        } catch {
          // Skip failed prefetch; selected cycle fetch remains source of truth.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cycles, fetchSummary, selectedCycleId]);

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
            String(row.nightSeconds),
            String(row.nightBonus),
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
      if (a.isExited !== b.isExited) {
        return a.isExited ? 1 : -1;
      }

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
  const snapshotStatus = summary?.snapshot?.status ?? null;
  const summaryRowsCount = summary?.totals.length ?? 0;
  const isSummaryCalculating =
    summaryLoading || snapshotStatus === 'building' || snapshotStatus === 'refreshing';
  const loadingMessage =
    snapshotStatus === 'refreshing' && summaryRowsCount > 0
      ? 'Actualizam pontajul in fundal. Datele afisate sunt ultima varianta salvata.'
      : 'Se calculeaza pontajul. Rezultatele apar automat imediat ce sunt gata.';

  useEffect(() => {
    if (!selectedCycleId || (snapshotStatus !== 'building' && snapshotStatus !== 'refreshing')) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchSummary(selectedCycleId, {
        background: summaryRowsCount > 0,
        force: true
      });
    }, snapshotStatus === 'building' ? 2500 : 4000);

    return () => window.clearTimeout(timer);
  }, [fetchSummary, selectedCycleId, snapshotStatus, summaryRowsCount]);

  const openHistoryModal = async (employeeId: number | null, label: string) => {
    if (!employeeId || !selectedCycleId) {
      return;
    }

    const [eventsResponse, rankResponse] = await Promise.all([
      apiGet<TimeEventHistoryResponse>(`/timesheet/employee/${employeeId}/history?cycleId=${selectedCycleId}`),
      apiGet<EmployeeRankHistoryResponse>(`/timesheet/employee/${employeeId}/rank-history?cycleId=${selectedCycleId}`)
    ]);

    setHistoryModalTitle(label);
    setHistoryTab('events');
    setHistoryRows(eventsResponse.history);
    setRankHistoryRows(rankResponse.history);
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
        {isSummaryCalculating ? (
          <div className="timesheet-loading-banner" role="status" aria-live="polite">
            <span className="loading-spinner" aria-hidden="true" />
            <span>{loadingMessage}</span>
          </div>
        ) : null}
        {summary?.snapshot?.status === 'failed' ? (
          <div className="timesheet-loading-banner is-error" role="alert">
            Nu am putut genera sumarul acestui ciclu: {summary.snapshot.error ?? 'eroare necunoscuta'}.
          </div>
        ) : null}
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
              <th>Bonus noapte</th>
              <th>Salariu</th>
              <th>Platit</th>
              <th>Up</th>
              <th>Istoric</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const upState = getUpVisualState(row);
              const showExitedSeparator = row.isExited && index > 0 && !visibleRows[index - 1].isExited;

              return (
                <Fragment key={row.key}>
                  {showExitedSeparator ? (
                    <tr className="timesheet-separator-row">
                      <td colSpan={12}>Angajati iesiti din service</td>
                    </tr>
                  ) : null}
                  <tr
                    className={[
                      row.payroll.isPaid ? 'is-paid' : '',
                      row.inactiveLast3Weeks ? 'is-inactive' : '',
                      row.isExited ? 'is-exited' : ''
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
                          {row.isExited ? <span className="badge muted">Iesit</span> : null}
                          {row.inactiveLast3Weeks ? (
                            <span className="badge danger" title="Pontaj 0 in ultimele 3 saptamani complete">
                              0 in ultimele 3
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          {row.displayName}
                          {row.isExited ? <span className="badge muted">Iesit</span> : null}
                          {row.inactiveLast3Weeks ? (
                            <span className="badge danger" title="Pontaj 0 in ultimele 3 saptamani complete">
                              0 in ultimele 3
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="timesheet-months-cell">
                        <span>{row.rank ?? '-'}</span>
                      </div>
                    </td>
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
                    <td title={`18:00-23:00 | ${formatMinutes(row.nightSeconds)} | ${formatCurrency(row.nightBonus)}`}>
                      {formatCurrency(row.nightBonus)}
                    </td>
                    <td
                      title={`Baza: ${formatCurrency(row.baseSalary)} | Bonus noapte: ${formatCurrency(
                        row.nightBonus
                      )} | Bonus top: ${formatCurrency(row.topBonus)}`}
                    >
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
                        onClick={() => void openHistoryModal(row.employeeId, row.displayName)}
                        disabled={!row.employeeId}
                      >
                        Istoric
                      </button>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {!visibleRows.length ? (
              <tr>
                <td colSpan={12}>
                  {isSummaryCalculating
                    ? 'Se calculeaza rezultatele pentru acest ciclu...'
                    : inactiveOnly
                    ? 'Nu exista angajati marcati ca inactivi pentru acest ciclu.'
                    : 'Nu exista pontaje in ciclul selectat.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {historyModalTitle ? (
        <div className="modal-backdrop">
          <div className="modal large">
            <h3>Istoric complet: {historyModalTitle}</h3>
            <div className="modal-tabs">
              <button
                type="button"
                className={historyTab === 'events' ? 'active' : ''}
                onClick={() => setHistoryTab('events')}
              >
                Evenimente
              </button>
              <button
                type="button"
                className={historyTab === 'rank' ? 'active' : ''}
                onClick={() => setHistoryTab('rank')}
              >
                Istoric rank
              </button>
            </div>
            <div className="raw-list">
              {historyTab === 'events'
                ? historyRows.map((event) => (
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
                  ))
                : rankHistoryRows.map((item) => (
                    <article key={item.id} className="raw-item">
                      <header>
                        <strong>{item.rank}</strong>
                        <span>{formatDateTime(item.effectiveFrom)}</span>
                      </header>
                      <p>
                        Sursa: <strong>{item.source ?? '-'}</strong> | Schimbat de: <strong>{item.changedBy ?? '-'}</strong>
                      </p>
                    </article>
                  ))}
              {historyTab === 'events' && !historyRows.length ? (
                <p>Nu exista evenimente in acest ciclu pentru angajat.</p>
              ) : null}
              {historyTab === 'rank' && !rankHistoryRows.length ? (
                <p>Nu exista istoric rank pentru acest ciclu.</p>
              ) : null}
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setHistoryModalTitle(null);
                  setHistoryRows([]);
                  setRankHistoryRows([]);
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

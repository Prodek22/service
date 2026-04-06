import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api/client';
import { AuditLog, AuditLogsResponse } from '../types';
import { formatDateTime } from '../utils/format';

const prettyMetadata = (metadata: unknown): string => {
  if (!metadata) {
    return '-';
  }

  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
};

export const AuditLogsPage = () => {
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [draftActionFilter, setDraftActionFilter] = useState('');
  const [draftActorFilter, setDraftActorFilter] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });

    if (actionFilter.trim()) {
      params.set('action', actionFilter.trim());
    }

    if (actorFilter.trim()) {
      params.set('actorUsername', actorFilter.trim());
    }

    return params.toString();
  }, [page, pageSize, actionFilter, actorFilter]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<AuditLogsResponse>(`/audit?${query}`);
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca logurile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [query]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setActionFilter(draftActionFilter);
    setActorFilter(draftActorFilter);
  };

  const clearFilters = () => {
    setDraftActionFilter('');
    setDraftActorFilter('');
    setActionFilter('');
    setActorFilter('');
    setPage(1);
  };

  return (
    <section>
      <h2>Loguri actiuni (Audit)</h2>

      <form className="card filters" onSubmit={applyFilters}>
        <input
          placeholder="Filtru actiune (ex: PAYROLL_STATUS_UPDATED)"
          value={draftActionFilter}
          onChange={(event) => setDraftActionFilter(event.target.value)}
        />
        <input
          placeholder="Filtru utilizator (ex: pdk)"
          value={draftActorFilter}
          onChange={(event) => setDraftActorFilter(event.target.value)}
        />
        <button type="submit">Aplica filtre</button>
        <button type="button" onClick={clearFilters}>
          Reseteaza
        </button>
      </form>

      {loading ? <p>Se incarca logurile...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="card table-wrapper">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Utilizator</th>
              <th>Rol</th>
              <th>Actiune</th>
              <th>Entitate</th>
              <th>ID entitate</th>
              <th>IP</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item: AuditLog) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>{item.actorUsername ?? '-'}</td>
                <td>{item.actorRole ?? '-'}</td>
                <td>
                  <code>{item.action}</code>
                </td>
                <td>{item.entityType ?? '-'}</td>
                <td>{item.entityId ?? '-'}</td>
                <td>{item.ipAddress ?? '-'}</td>
                <td>
                  {item.metadata ? (
                    <details>
                      <summary>Vezi</summary>
                      <pre>{prettyMetadata(item.metadata)}</pre>
                    </details>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
            {!loading && !(data?.items ?? []).length ? (
              <tr>
                <td colSpan={8}>Nu exista loguri pentru filtrele selectate.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Pagina anterioara
        </button>
        <span>
          Pagina {data?.pagination.page ?? page} din {data?.pagination.totalPages ?? 1}
        </span>
        <button
          disabled={
            loading ||
            !data ||
            data.pagination.totalPages === 0 ||
            page >= data.pagination.totalPages
          }
          onClick={() => setPage((current) => current + 1)}
        >
          Pagina urmatoare
        </button>
      </div>
    </section>
  );
};

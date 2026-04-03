import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '../api/client';
import { Employee, EmployeeCvRawEntry, EmployeesResponse } from '../types';
import { formatDateTime } from '../utils/format';

type EmployeeEdit = Partial<Pick<Employee, 'iban' | 'monthsInCity' | 'nickname' | 'fullName' | 'phone' | 'rank' | 'idImageUrl'>> & {
  status?: Employee['status'];
};

export const EmployeesPage = () => {
  const [data, setData] = useState<EmployeesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [missingImage, setMissingImage] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState<EmployeeEdit>({});

  const [rawEmployeeId, setRawEmployeeId] = useState<number | null>(null);
  const [rawEntries, setRawEntries] = useState<EmployeeCvRawEntry[]>([]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '15',
      sortBy,
      sortDir
    });

    if (search.trim()) {
      params.set('search', search.trim());
    }

    if (status) {
      params.set('status', status);
    }

    if (missingImage) {
      params.set('missingImage', 'true');
    }

    if (incompleteOnly) {
      params.set('incompleteOnly', 'true');
    }

    return params.toString();
  }, [page, search, status, missingImage, incompleteOnly, sortBy, sortDir]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<EmployeesResponse>(`/employees?${query}`);
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca lista.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [query]);

  const openEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setEditForm({
      iban: employee.iban ?? '',
      monthsInCity: employee.monthsInCity ?? 0,
      nickname: employee.nickname ?? '',
      fullName: employee.fullName ?? '',
      phone: employee.phone ?? '',
      rank: employee.rank ?? '',
      idImageUrl: employee.idImageUrl ?? '',
      status: employee.status
    });
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();

    if (!editingEmployee) {
      return;
    }

    await apiPatch(`/employees/${editingEmployee.id}`, {
      ...editForm,
      monthsInCity: Number(editForm.monthsInCity ?? 0)
    });

    setEditingEmployee(null);
    await load();
  };

  const openRaw = async (employeeId: number) => {
    setRawEmployeeId(employeeId);
    const response = await apiGet<EmployeeCvRawEntry[]>(`/employees/${employeeId}/raw`);
    setRawEntries(response);
  };

  return (
    <section>
      <h2>Angajati / CV-uri</h2>

      <div className="card filters">
        <input
          placeholder="Cauta dupa nume, iban, telefon, rank..."
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
        />
        <select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        >
          <option value="">Toate statusurile</option>
          <option value="ACTIVE">Active</option>
          <option value="INCOMPLETE">Incomplete</option>
          <option value="DELETED">Sterse (soft)</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={missingImage}
            onChange={(event) => {
              setPage(1);
              setMissingImage(event.target.checked);
            }}
          />
          Doar fara poza buletin
        </label>
        <label>
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(event) => {
              setPage(1);
              setIncompleteOnly(event.target.checked);
            }}
          />
          Doar CV incomplete
        </label>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="created_at">Sortare: Data intrare</option>
          <option value="updated_at">Sortare: Ultima actualizare</option>
          <option value="months">Sortare: Luni in oras</option>
          <option value="full_name">Sortare: Nume</option>
          <option value="rank">Sortare: Rank</option>
        </select>
        <button onClick={() => setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))}>
          Directie: {sortDir === 'asc' ? 'Asc' : 'Desc'}
        </button>
      </div>

      {loading && <p>Se incarca...</p>}
      {error && <p className="error">{error}</p>}

      <div className="card table-wrapper">
        <table>
          <thead>
            <tr>
              <th>IBAN</th>
              <th>LUNI</th>
              <th>PORECLA</th>
              <th>NUME & PRENUME</th>
              <th>TELEFON</th>
              <th>RANK</th>
              <th>INTRARE</th>
              <th>BULETIN</th>
              <th>STATUS</th>
              <th>ACTIUNI</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((employee) => (
              <tr key={employee.id}>
                <td>{employee.iban ?? '-'}</td>
                <td>{employee.monthsInCity ?? '-'}</td>
                <td>{employee.nickname ?? '-'}</td>
                <td>{employee.fullName ?? '-'}</td>
                <td>{employee.phone ?? '-'}</td>
                <td>{employee.rank ?? '-'}</td>
                <td>{formatDateTime(employee.cvPostedAt)}</td>
                <td>
                  {employee.idImageUrl ? (
                    <a href={employee.idImageUrl} target="_blank" rel="noreferrer">
                      Deschide
                    </a>
                  ) : (
                    <span className="badge warning">Lipsa</span>
                  )}
                </td>
                <td>
                  {employee.isIncomplete ? <span className="badge warning">INCOMPLET</span> : null}
                  {employee.status === 'ACTIVE' ? <span className="badge ok">ACTIV</span> : null}
                  {employee.status === 'DELETED' ? <span className="badge muted">Sters</span> : null}
                </td>
                <td>
                  <button onClick={() => openEdit(employee)}>Editeaza</button>
                  <button onClick={() => void openRaw(employee.id)}>Raw</button>
                </td>
              </tr>
            ))}
            {!data?.items.length && !loading ? (
              <tr>
                <td colSpan={10}>Nu exista inregistrari pentru filtrele selectate.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Pagina anterioara
        </button>
        <span>
          Pagina {data?.pagination.page ?? 1} din {data?.pagination.totalPages ?? 1}
        </span>
        <button
          disabled={Boolean(data && page >= data.pagination.totalPages)}
          onClick={() => setPage((current) => current + 1)}
        >
          Pagina urmatoare
        </button>
      </div>

      {editingEmployee ? (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={submitEdit}>
            <h3>Editare: {editingEmployee.fullName ?? editingEmployee.nickname ?? editingEmployee.id}</h3>
            <input value={editForm.iban ?? ''} onChange={(event) => setEditForm((v) => ({ ...v, iban: event.target.value }))} placeholder="IBAN" />
            <input
              value={String(editForm.monthsInCity ?? 0)}
              onChange={(event) => setEditForm((v) => ({ ...v, monthsInCity: Number.parseInt(event.target.value, 10) || 0 }))}
              placeholder="Luni in oras"
            />
            <input value={editForm.nickname ?? ''} onChange={(event) => setEditForm((v) => ({ ...v, nickname: event.target.value }))} placeholder="Porecla" />
            <input value={editForm.fullName ?? ''} onChange={(event) => setEditForm((v) => ({ ...v, fullName: event.target.value }))} placeholder="Nume complet" />
            <input value={editForm.phone ?? ''} onChange={(event) => setEditForm((v) => ({ ...v, phone: event.target.value }))} placeholder="Telefon" />
            <input value={editForm.rank ?? ''} onChange={(event) => setEditForm((v) => ({ ...v, rank: event.target.value }))} placeholder="Rank" />
            <input
              value={editForm.idImageUrl ?? ''}
              onChange={(event) => setEditForm((v) => ({ ...v, idImageUrl: event.target.value }))}
              placeholder="Link poza buletin"
            />
            <select value={editForm.status ?? 'INCOMPLETE'} onChange={(event) => setEditForm((v) => ({ ...v, status: event.target.value as Employee['status'] }))}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INCOMPLETE">INCOMPLETE</option>
              <option value="DELETED">DELETED</option>
            </select>
            <div className="modal-actions">
              <button type="submit">Salveaza</button>
              <button type="button" onClick={() => setEditingEmployee(null)}>
                Anuleaza
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {rawEmployeeId ? (
        <div className="modal-backdrop">
          <div className="modal large">
            <h3>Raw CV entries - angajat #{rawEmployeeId}</h3>
            <div className="raw-list">
              {rawEntries.map((entry) => (
                <article key={entry.id} className="raw-item">
                  <header>
                    <strong>{entry.parseStatus}</strong>
                    <span>{formatDateTime(entry.createdAt)}</span>
                  </header>
                  <p>{entry.parseNotes ?? '-'}</p>
                  <pre>{entry.rawText}</pre>
                </article>
              ))}
              {!rawEntries.length && <p>Nu exista intrari raw.</p>}
            </div>
            <div className="modal-actions">
              <button onClick={() => setRawEmployeeId(null)}>Inchide</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

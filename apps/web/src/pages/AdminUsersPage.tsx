import { FormEvent, useEffect, useState } from 'react';
import { ApiError, apiGet, apiPost } from '../api/client';
import { AdminRole, AdminUserAccount, AdminUsersResponse, CreateAdminUserResponse } from '../types';
import { formatDateTime } from '../utils/format';

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.message) as { error?: string };
      return parsed.error ?? fallback;
    } catch {
      return error.message || fallback;
    }
  }

  return error instanceof Error ? error.message : fallback;
};

export const AdminUsersPage = () => {
  const [users, setUsers] = useState<AdminUserAccount[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('VIEWER');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<AdminUsersResponse>('/admin-users');
      setUsers(response.items);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Nu am putut incarca utilizatorii.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiPost<CreateAdminUserResponse>('/admin-users', {
        username,
        password,
        role
      });

      setUsers((current) =>
        [...current.filter((item) => item.id !== response.item.id), response.item].sort((a, b) =>
          a.username.localeCompare(b.username)
        )
      );
      setUsername('');
      setPassword('');
      setRole('VIEWER');
      setSuccess(`User creat: ${response.item.username} (${response.item.role})`);
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Nu am putut crea userul.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-users-page">
      <div className="page-hero">
        <div>
          <span className="page-hero-eyebrow">Acces pdk</span>
          <h2>Utilizatori admin</h2>
          <p>Creeaza conturi noi pentru panou si alege rolul fiecarui utilizator.</p>
        </div>
      </div>

      <form className="card filters admin-user-form" onSubmit={createUser}>
        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="ex: mecanic01"
            autoComplete="off"
            minLength={3}
            maxLength={64}
            required
          />
        </label>
        <label>
          Parola
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="minim 8 caractere"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label>
          Rol
          <select value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
            <option value="VIEWER">VIEWER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </label>
        <button type="submit" disabled={saving}>
          {saving ? 'Se creeaza...' : 'Creeaza user'}
        </button>
      </form>

      {success ? <p className="success">{success}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p>Se incarca utilizatorii...</p> : null}

      <div className="card table-wrapper">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Rol</th>
              <th>Status</th>
              <th>Creat</th>
              <th>Actualizat</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.username}</strong>
                </td>
                <td>
                  <span className={`badge ${user.role === 'ADMIN' ? 'warning' : 'muted'}`}>{user.role}</span>
                </td>
                <td>
                  <span className={`badge ${user.isActive ? 'ok' : 'danger'}`}>
                    {user.isActive ? 'Activ' : 'Inactiv'}
                  </span>
                </td>
                <td>{formatDateTime(user.createdAt)}</td>
                <td>{formatDateTime(user.updatedAt)}</td>
              </tr>
            ))}
            {!loading && !users.length ? (
              <tr>
                <td colSpan={5}>Nu exista utilizatori de afisat.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};

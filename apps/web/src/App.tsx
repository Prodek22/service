import { useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { ApiError, apiPost, apiGet } from './api/client';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LoginPage } from './pages/LoginPage';
import { TimesheetPage } from './pages/TimesheetPage';
import { AuthMeResponse } from './types';

type AuthState = {
  checked: boolean;
  authenticated: boolean;
  username: string | null;
};

export const App = () => {
  const [auth, setAuth] = useState<AuthState>({
    checked: false,
    authenticated: false,
    username: null
  });
  const [loginLoading, setLoginLoading] = useState(false);

  const refreshAuth = async () => {
    try {
      const me = await apiGet<AuthMeResponse>('/auth/me');
      setAuth({
        checked: true,
        authenticated: Boolean(me.authenticated),
        username: me.username ?? null
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth({ checked: true, authenticated: false, username: null });
        return;
      }

      setAuth({ checked: true, authenticated: false, username: null });
    }
  };

  useEffect(() => {
    void refreshAuth();
  }, []);

  const handleLogin = async (username: string, password: string) => {
    setLoginLoading(true);
    try {
      await apiPost('/auth/login', { username, password });
      await refreshAuth();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new Error('Username sau password incorect.');
      }

      throw error;
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await apiPost('/auth/logout', {});
    setAuth({ checked: true, authenticated: false, username: null });
  };

  const headerUser = useMemo(() => auth.username ?? 'admin', [auth.username]);

  if (!auth.checked) {
    return <div className="auth-shell"><div className="auth-card"><p>Se verifică sesiunea...</p></div></div>;
  }

  if (!auth.authenticated) {
    return <LoginPage loading={loginLoading} onLogin={handleLogin} />;
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Service Admin</h1>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboard
          </NavLink>
          <NavLink to="/employees" className={({ isActive }) => (isActive ? 'active' : '')}>
            Angajati & CV-uri
          </NavLink>
          <NavLink to="/timesheet" className={({ isActive }) => (isActive ? 'active' : '')}>
            Pontaj saptamanal
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <span>Logat ca: {headerUser}</span>
          <button type="button" onClick={() => void handleLogout()}>
            Logout
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/timesheet" element={<TimesheetPage />} />
        </Routes>
      </main>
    </div>
  );
};

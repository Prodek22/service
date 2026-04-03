import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, apiGet, apiPost } from './api/client';
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

const LoadingCard = () => (
  <div className="auth-shell">
    <div className="auth-card">
      <p>Se verifică sesiunea...</p>
    </div>
  </div>
);

type AdminLayoutProps = {
  username: string;
  onLogout: () => Promise<void>;
  children: ReactNode;
};

const AdminLayout = ({ username, onLogout, children }: AdminLayoutProps) => (
  <div className="layout">
    <aside className="sidebar">
      <h1>Service Admin</h1>
      <nav>
        <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'active' : '')}>
          Dashboard
        </NavLink>
        <NavLink to="/admin/employees" className={({ isActive }) => (isActive ? 'active' : '')}>
          Angajati & CV-uri
        </NavLink>
        <NavLink to="/admin/timesheet" className={({ isActive }) => (isActive ? 'active' : '')}>
          Pontaj saptamanal
        </NavLink>
        <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')}>
          Pagina publica
        </NavLink>
      </nav>
      <div className="sidebar-footer">
        <span>Logat ca: {username}</span>
        <button type="button" onClick={() => void onLogout()}>
          Logout
        </button>
      </div>
    </aside>
    <main className="content">{children}</main>
  </div>
);

type PublicLayoutProps = {
  isAuthenticated: boolean;
  username: string | null;
  onLogout: () => Promise<void>;
};

const PublicLayout = ({ isAuthenticated, username, onLogout }: PublicLayoutProps) => (
  <div className="public-shell">
    <header className="public-header">
      <div>
        <h1>Pontaj Service</h1>
        <p>Vizualizare publică read-only</p>
      </div>
    </header>
    <main className="content">
      <TimesheetPage readOnly />
    </main>
    <footer className="public-footer">
      <span>Copyright © {new Date().getFullYear()} Prodek.ink. All rights reserved.</span>
      <div className="public-footer-admin">
        {isAuthenticated ? (
          <>
            <span>Conectat: {username ?? 'admin'}</span>
            <Link to="/admin">Panou admin</Link>
            <button type="button" onClick={() => void onLogout()}>
              Logout
            </button>
          </>
        ) : (
          <Link to="/login" className="footer-admin-link">
            admin access
          </Link>
        )}
      </div>
    </footer>
  </div>
);

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

  const renderAdminPage = (content: ReactNode) => {
    if (!auth.checked) {
      return <LoadingCard />;
    }

    if (!auth.authenticated) {
      return <Navigate to="/login" replace />;
    }

    return (
      <AdminLayout username={headerUser} onLogout={handleLogout}>
        {content}
      </AdminLayout>
    );
  };

  return (
    <Routes>
      <Route
        path="/"
        element={<PublicLayout isAuthenticated={auth.authenticated} username={auth.username} onLogout={handleLogout} />}
      />
      <Route path="/login" element={auth.authenticated ? <Navigate to="/admin" replace /> : <LoginPage loading={loginLoading} onLogin={handleLogin} />} />
      <Route path="/admin" element={renderAdminPage(<DashboardPage />)} />
      <Route path="/admin/employees" element={renderAdminPage(<EmployeesPage />)} />
      <Route path="/admin/timesheet" element={renderAdminPage(<TimesheetPage />)} />
      <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="/employees" element={<Navigate to="/admin/employees" replace />} />
      <Route path="/timesheet" element={<Navigate to="/admin/timesheet" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

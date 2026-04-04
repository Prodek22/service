import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, apiGet, apiPost } from './api/client';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LoginPage } from './pages/LoginPage';
import { TimesheetPage } from './pages/TimesheetPage';
import { AdminRole, AuthMeResponse } from './types';

type ThemeMode = 'light' | 'dark';

type AuthState = {
  checked: boolean;
  authenticated: boolean;
  username: string | null;
  role: AdminRole | null;
};

const LoadingCard = () => (
  <div className="auth-shell">
    <div className="auth-card">
      <p>Se verifica sesiunea...</p>
    </div>
  </div>
);

type AdminLayoutProps = {
  username: string;
  role: AdminRole;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogout: () => Promise<void>;
  children: ReactNode;
};

const AdminLayout = ({ username, role, theme, onToggleTheme, onLogout, children }: AdminLayoutProps) => {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Service Admin</h1>
        <button type="button" className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? 'Tema light' : 'Tema dark'}
        </button>
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
          <span>
            Logat ca: {username} ({role})
          </span>
          <button type="button" onClick={() => void onLogout()}>
            Logout
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
};

type PublicLayoutProps = {
  isAuthenticated: boolean;
  username: string | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogout: () => Promise<void>;
};

const PublicLayout = ({ isAuthenticated, username, theme, onToggleTheme, onLogout }: PublicLayoutProps) => {
  const [showAdminAccess, setShowAdminAccess] = useState(false);

  return (
    <div className="public-shell">
      <header className="public-header">
        <div>
          <h1>Pontaj Service</h1>
          <p>Vizualizare publica read-only</p>
        </div>
        <div className="public-header-actions">
          {isAuthenticated ? (
            <Link to="/admin" className="header-dashboard-link">
              Dashboard
            </Link>
          ) : null}
          <button type="button" className="theme-toggle" onClick={onToggleTheme}>
            {theme === 'dark' ? 'Tema light' : 'Tema dark'}
          </button>
        </div>
      </header>
      <main className="content">
        <TimesheetPage readOnly />
      </main>
      <footer className="public-footer">
        <p className="public-footer-copy">
          Copyright © {new Date().getFullYear()}{' '}
          <a className="brand-link" href="https://prodek.ink" target="_blank" rel="noreferrer">
            <span className="brand-word">Prodek.ink</span>
          </a>
          . All rights{' '}
          <span className="reserved-trigger" onClick={() => setShowAdminAccess((current) => !current)}>
            reserved
          </span>
          .
        </p>
        {showAdminAccess ? (
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
        ) : null}
      </footer>
    </div>
  );
};

export const App = () => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light';
    }

    const savedTheme = window.localStorage.getItem('service-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      return savedTheme;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [auth, setAuth] = useState<AuthState>({
    checked: false,
    authenticated: false,
    username: null,
    role: null
  });
  const [loginLoading, setLoginLoading] = useState(false);

  const refreshAuth = async () => {
    try {
      const me = await apiGet<AuthMeResponse>('/auth/me');
      setAuth({
        checked: true,
        authenticated: Boolean(me.authenticated),
        username: me.username ?? null,
        role: me.role ?? 'VIEWER'
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth({ checked: true, authenticated: false, username: null, role: null });
        return;
      }

      setAuth({ checked: true, authenticated: false, username: null, role: null });
    }
  };

  useEffect(() => {
    void refreshAuth();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('service-theme', theme);
  }, [theme]);

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
    setAuth({ checked: true, authenticated: false, username: null, role: null });
  };

  const headerUser = useMemo(() => auth.username ?? 'admin', [auth.username]);
  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  const renderAdminPage = (content: ReactNode) => {
    if (!auth.checked) {
      return <LoadingCard />;
    }

    if (!auth.authenticated || !auth.role) {
      return <Navigate to="/login" replace />;
    }

    return (
      <AdminLayout
        username={headerUser}
        role={auth.role}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
      >
        {content}
      </AdminLayout>
    );
  };

  return (
    <Routes>
      <Route
        path="/"
        element={
          <PublicLayout
            isAuthenticated={auth.authenticated}
            username={auth.username}
            theme={theme}
            onToggleTheme={toggleTheme}
            onLogout={handleLogout}
          />
        }
      />
      <Route
        path="/login"
        element={auth.authenticated ? <Navigate to="/admin" replace /> : <LoginPage loading={loginLoading} onLogin={handleLogin} />}
      />
      <Route path="/admin" element={renderAdminPage(<DashboardPage canManage={auth.role === 'ADMIN'} />)} />
      <Route path="/admin/employees" element={renderAdminPage(<EmployeesPage readOnly={auth.role !== 'ADMIN'} />)} />
      <Route path="/admin/timesheet" element={renderAdminPage(<TimesheetPage readOnly={auth.role !== 'ADMIN'} />)} />
      <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="/employees" element={<Navigate to="/admin/employees" replace />} />
      <Route path="/timesheet" element={<Navigate to="/admin/timesheet" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

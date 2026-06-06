import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, apiGet, apiPost } from './api/client';
import { ActiveTimesheetsPage } from './pages/ActiveTimesheetsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LoginPage } from './pages/LoginPage';
import { ReactionTrackingPage } from './pages/ReactionTrackingPage';
import { TimesheetPage } from './pages/TimesheetPage';
import { AdminRole, AuthMeResponse } from './types';

type ThemeMode = 'light' | 'dark' | 'copper';

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

type SiteFooterProps = {
  isAuthenticated?: boolean;
  username?: string | null;
  onLogout?: () => Promise<void>;
  showAdminAccess?: boolean;
};

const SiteFooter = ({ isAuthenticated = false, username = null, onLogout, showAdminAccess = false }: SiteFooterProps) => {
  const [showAdminControls, setShowAdminControls] = useState(false);

  return (
    <footer className="public-footer">
      <p className="public-footer-copy">
        Copyright © {new Date().getFullYear()}{' '}
        <a className="brand-link" href="https://prodek.ink" target="_blank" rel="noreferrer">
          <span className="brand-word">Prodek.ink</span>
        </a>
        . All rights{' '}
        <span
          className="reserved-trigger"
          onClick={showAdminAccess ? () => setShowAdminControls((current) => !current) : undefined}
        >
          reserved
        </span>
        .
      </p>
      {showAdminAccess && showAdminControls ? (
        <div className="public-footer-admin">
          {isAuthenticated ? (
            <>
              <span>Conectat: {username ?? 'admin'}</span>
              <Link to="/admin">Panou admin</Link>
              {onLogout ? (
                <button type="button" onClick={() => void onLogout()}>
                  Logout
                </button>
              ) : null}
            </>
          ) : (
            <Link to="/login" className="footer-admin-link">
              admin access
            </Link>
          )}
        </div>
      ) : null}
    </footer>
  );
};

const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  copper: 'Copper'
};

const getNextTheme = (current: ThemeMode): ThemeMode => {
  if (current === 'light') {
    return 'dark';
  }

  if (current === 'dark') {
    return 'copper';
  }

  return 'light';
};

const getSectionMeta = (pathname: string): { eyebrow: string; title: string; subtitle: string } => {
  if (pathname.startsWith('/admin/employees')) {
    return {
      eyebrow: 'Monitorizare si control',
      title: 'Gestionare personal',
      subtitle: 'Monitorizeaza si administreaza toti membrii echipei.'
    };
  }

  if (pathname.startsWith('/admin/reactions')) {
    return {
      eyebrow: 'Flux monitorizat',
      title: 'Reacturi mesaje',
      subtitle: 'Urmareste mesajele si istoricul de reactii din sistem.'
    };
  }

  if (pathname.startsWith('/admin/audit')) {
    return {
      eyebrow: 'Control intern',
      title: 'Audit actiuni',
      subtitle: 'Vezi cine a modificat datele si cand.'
    };
  }

  return {
    eyebrow: 'Monitorizare si control',
    title: 'Panou personal',
    subtitle: 'Ai control total asupra echipei si operatiunilor.'
  };
};

type AdminLayoutProps = {
  username: string;
  role: AdminRole;
  canViewAudit: boolean;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogout: () => Promise<void>;
  children: ReactNode;
};

const AdminLayout = ({ username, role, canViewAudit, theme, onToggleTheme, onLogout, children }: AdminLayoutProps) => {
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem('service-sidebar-collapsed') === 'true';
  });
  const [globalSearch, setGlobalSearch] = useState('');
  const sectionMeta = useMemo(() => getSectionMeta(location.pathname), [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem('service-sidebar-collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  return (
    <div className={`layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={!isSidebarCollapsed}
        onClick={() => setIsSidebarCollapsed((current) => !current)}
      >
        <span className="sidebar-toggle-icon" aria-hidden="true">
          {isSidebarCollapsed ? '>>' : '<<'}
        </span>
        {isSidebarCollapsed ? 'Arata meniu' : 'Ascunde meniu'}
      </button>
      {!isSidebarCollapsed ? (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-badge">NX</div>
            <div>
              <h1>Paradise</h1>
              <p>Monitorizare operativa</p>
            </div>
          </div>
          <div className="sidebar-meta-card">
            <span className="sidebar-meta-label">Tema activa</span>
            <button type="button" className="theme-toggle sidebar-theme-toggle" onClick={onToggleTheme}>
              Tema: {THEME_LABELS[theme]}
            </button>
          </div>
          <nav>
            <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="sidebar-nav-icon">DB</span>
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/admin/employees" className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="sidebar-nav-icon">PS</span>
              <span>Personal</span>
            </NavLink>
            {role === 'ADMIN' ? (
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="sidebar-nav-icon">PJ</span>
                <span>Program</span>
              </NavLink>
            ) : null}
            {role === 'ADMIN' ? (
              <NavLink to="/admin/reactions" className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="sidebar-nav-icon">RM</span>
                <span>Rapoarte</span>
              </NavLink>
            ) : null}
            {canViewAudit ? (
              <NavLink to="/admin/audit" className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="sidebar-nav-icon">LG</span>
                <span>Disciplina</span>
              </NavLink>
            ) : null}
          </nav>
          <div className="sidebar-footer">
            <div className="sidebar-status-card">
              <span className="sidebar-meta-label">Server status</span>
              <strong>Online</strong>
              <span className="sidebar-status-dot" />
            </div>
            <span>
              Logat ca: {username} ({role})
            </span>
            <button type="button" onClick={() => void onLogout()}>
              Logout
            </button>
          </div>
        </aside>
      ) : null}
      <div className="layout-main">
        <header className="admin-topbar">
          <div className="admin-topbar-copy">
            <span className="admin-topbar-eyebrow">{sectionMeta.eyebrow}</span>
            <strong>{sectionMeta.title}</strong>
            <p>{sectionMeta.subtitle}</p>
          </div>
          <div className="admin-topbar-search">
            <input
              type="search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Cauta dupa nume, porecla, IBAN..."
            />
            <span className="admin-topbar-shortcut">CTRL</span>
          </div>
          <div className="admin-topbar-profile">
            <div className="admin-topbar-alerts">
              <span className="admin-signal-dot" />
              <span className="admin-signal-dot" />
            </div>
            <div className="admin-topbar-user">
              <div className="admin-avatar-ring">
                <span>{String(username ?? 'A').slice(0, 1).toUpperCase()}</span>
              </div>
              <div>
                <strong>{username}</strong>
                <p>{role === 'ADMIN' ? 'Online' : 'Vizualizare'}</p>
              </div>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
};

type PublicLayoutProps = {
  isAuthenticated: boolean;
  username: string | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogout: () => Promise<void>;
  view: 'weekly' | 'active';
  canManageWeeklyControls: boolean;
  canManageActiveControls: boolean;
  showFooter?: boolean;
};

const PublicLayout = ({
  isAuthenticated,
  username,
  theme,
  onToggleTheme,
  onLogout,
  view,
  canManageWeeklyControls,
  canManageActiveControls,
  showFooter = true
}: PublicLayoutProps) => {
  const canManageCurrentView = view === 'active' ? canManageActiveControls : canManageWeeklyControls;

  return (
    <div className={`public-shell ${showFooter ? '' : 'embedded'}`.trim()}>
      <header className="public-header">
        <div>
          <h1>Pontaj Service</h1>
          <p>{canManageCurrentView ? 'Optiuni admin active pe pagina publica' : 'Vizualizare publica read-only'}</p>
          <div className="public-nav-links">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              Pontaj saptamanal
            </NavLink>
            <NavLink to="/timesheet-active" className={({ isActive }) => (isActive ? 'active' : '')}>
              Pontaje active
            </NavLink>
          </div>
        </div>
        <button type="button" className="theme-toggle" onClick={onToggleTheme}>
          Tema: {THEME_LABELS[theme]}
        </button>
      </header>
      <main className="content">
        {view === 'active' ? (
          <ActiveTimesheetsPage canManage={canManageActiveControls} />
        ) : (
          <TimesheetPage readOnly={!canManageWeeklyControls} />
        )}
      </main>
      {showFooter ? (
        <SiteFooter
          isAuthenticated={isAuthenticated}
          username={username}
          onLogout={onLogout}
          showAdminAccess
        />
      ) : null}
    </div>
  );
};

export const App = () => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light';
    }

    const savedTheme = window.localStorage.getItem('service-theme');
    if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'copper') {
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
  const canViewAudit = useMemo(
    () => auth.role === 'ADMIN' && String(auth.username ?? '').trim().toLowerCase() === 'pdk',
    [auth.role, auth.username]
  );
  const toggleTheme = () => setTheme((current) => getNextTheme(current));

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
        canViewAudit={canViewAudit}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
      >
        {content}
      </AdminLayout>
    );
  };

  const renderPublicPage = (view: 'weekly' | 'active') => {
    const publicPage = (
      <PublicLayout
        isAuthenticated={auth.authenticated}
        username={auth.username}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
        view={view}
        canManageWeeklyControls={auth.role === 'ADMIN'}
        canManageActiveControls={auth.role === 'ADMIN'}
        showFooter={!auth.checked || !auth.authenticated || !auth.role}
      />
    );

    if (!auth.checked || !auth.authenticated || !auth.role) {
      return publicPage;
    }

    return (
      <AdminLayout
        username={headerUser}
        role={auth.role}
        canViewAudit={canViewAudit}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
      >
        {publicPage}
      </AdminLayout>
    );
  };

  return (
    <Routes>
      <Route path="/" element={renderPublicPage('weekly')} />
      <Route path="/timesheet-active" element={renderPublicPage('active')} />
      <Route
        path="/login"
        element={
          auth.authenticated ? (
            <Navigate to="/admin" replace />
          ) : (
            <div className="auth-page">
              <LoginPage loading={loginLoading} onLogin={handleLogin} />
              <SiteFooter showAdminAccess />
            </div>
          )
        }
      />
      <Route path="/admin" element={renderAdminPage(<DashboardPage canManage={auth.role === 'ADMIN'} />)} />
      <Route path="/admin/employees" element={renderAdminPage(<EmployeesPage readOnly={auth.role !== 'ADMIN'} />)} />
      <Route path="/admin/timesheet" element={renderAdminPage(auth.role === 'ADMIN' ? <Navigate to="/" replace /> : <Navigate to="/admin" replace />)} />
      <Route
        path="/admin/timesheet-active"
        element={renderAdminPage(auth.role === 'ADMIN' ? <Navigate to="/timesheet-active" replace /> : <Navigate to="/admin" replace />)}
      />
      <Route
        path="/admin/reactions"
        element={renderAdminPage(auth.role === 'ADMIN' ? <ReactionTrackingPage /> : <Navigate to="/admin" replace />)}
      />
      <Route
        path="/admin/audit"
        element={renderAdminPage(canViewAudit ? <AuditLogsPage /> : <Navigate to="/admin" replace />)}
      />
      <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="/employees" element={<Navigate to="/admin/employees" replace />} />
      <Route path="/timesheet" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

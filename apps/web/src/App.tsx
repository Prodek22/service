import { NavLink, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { TimesheetPage } from './pages/TimesheetPage';

export const App = () => (
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

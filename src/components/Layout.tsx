import { WorkspaceBanner } from './WorkspaceBanner';
import { useEngagement } from '../engagement/EngagementProvider';
import { localBackend } from '../lib/backend-version';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FileText,
  Flag,
  HeartPulse,
  Bell,
  Settings2,
  ClipboardCheck,
  CalendarDays,
  BarChart3,
  Menu,
  X,
  LogOut,
  ChevronRight,
  Compass,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { demoEnabled } from '../lib/supabase';
import { roleLabel, type Role } from '../types/shared';
import { Brand } from './Brand';
import { ConfirmDialog, ErrorMessage } from './ui';
export const navigation: Record<Role, { path: string; label: string; icon: LucideIcon }[]> = {
  student: [
    { path: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { path: 'group', label: 'My group', icon: Users },
    { path: 'results', label: 'My results', icon: ClipboardCheck },
    { path: 'proposal', label: 'Proposal', icon: FileText },
    { path: 'milestones', label: 'Milestones', icon: Flag },
    { path: 'governance', label: 'Meetings & feedback', icon: CalendarDays },
    { path: 'peers', label: 'Peer evidence', icon: Users },
    { path: 'notices', label: 'My notices', icon: Bell },
  ],
  supervisor: [
    { path: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { path: 'groups', label: 'Allocated groups', icon: Users },
    { path: 'proposals', label: 'Proposal reviews', icon: FileText },
    { path: 'milestones', label: 'Milestone reviews', icon: Flag },
    { path: 'governance', label: 'Meetings & feedback', icon: CalendarDays },
    { path: 'assessment', label: 'Supervisor marks', icon: ClipboardCheck },
    { path: 'health', label: 'Group health', icon: HeartPulse },
    { path: 'peers', label: 'Peer evidence', icon: Users },
    { path: 'notices', label: 'Notices', icon: Bell },
  ],
  examiner: [
    { path: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { path: 'defenses', label: 'Assigned defenses', icon: ClipboardCheck },
  ],
  coordinator: [
    { path: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { path: 'assessment', label: 'Assessments & results', icon: ClipboardCheck },
    { path: 'governance', label: 'Rubrics & governance', icon: CalendarDays },
    { path: 'configuration', label: 'Configuration', icon: Settings2 },
    { path: 'matching', label: 'Supervisor matching', icon: Users },
    { path: 'health', label: 'Health Agent', icon: HeartPulse },
    { path: 'notices', label: 'Notifications', icon: Bell },
    { path: 'reports', label: 'Reports', icon: BarChart3 },
  ],
};
for (const role of Object.keys(navigation) as Role[])
  navigation[role].push(
    { path: 'assistants', label: 'AI assistants', icon: Compass },
    { path: 'help', label: 'Help & reminders', icon: Compass },
    { path: 'privacy-requests', label: 'Data requests', icon: FileText },
    { path: 'security', label: 'Account security', icon: Settings2 },
  );
navigation.coordinator.push(
  { path: 'users', label: 'Invite users', icon: Users },
  { path: 'enquiries', label: 'Enquiry inbox', icon: FileText },
  { path: 'service-status', label: 'Service status', icon: HeartPulse },
  { path: 'case-studies', label: 'Case studies', icon: BarChart3 },
);
export function Layout() {
  const { workspace } = useEngagement();
  const unread = workspace?.reminders.filter((x) => !x.read_at).length || 0;
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [mobile, setMobile] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  const activeLabel =
    navigation[user.role].find(
      (item) =>
        location.pathname === `/${user.role}/${item.path}` ||
        location.pathname.startsWith(`/${user.role}/${item.path}/`),
    )?.label || 'Workspace';
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign out.');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand light />
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">{roleLabel[user.role]} workspace</div>
        <nav aria-label="Main navigation">
          {navigation[user.role].map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={`/${user.role}/${path}`}
              onClick={() => setMobile(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{label}</span>
              {path === 'dashboard' && <span className="nav-active-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="direction-card">
            <Compass size={24} strokeWidth={1.5} />
            <strong>One step at a time.</strong>
            <p>Good projects start with a clear direction.</p>
            <span>YOUR FYP JOURNEY</span>
          </div>
          <button className="logout-button" onClick={() => setConfirm(true)}>
            <LogOut size={18} />
            Sign out
          </button>
          <span className="sidebar-version">FYP COMPASS</span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="app-header">
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{activeLabel}</strong>
          </div>
          <div className="header-user">
            <NavLink
              className="reminder-bell"
              to={`/${user.role}/help`}
              aria-label={`Help and reminders, ${unread} unread`}
            >
              <Bell size={18} />
              {unread > 0 && <span>{unread}</span>}
            </NavLink>
            <span className="mode-indicator">
              <span />
              {localBackend
                ? 'Local backend demo'
                : demoEnabled
                  ? 'Demo workspace'
                  : 'Connected workspace'}
            </span>
            <div className="user-avatar">
              {user.full_name
                .split(' ')
                .filter(Boolean)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div className="user-details">
              <strong>{user.full_name}</strong>
              <span>{roleLabel[user.role]}</span>
            </div>
          </div>
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          {error && <ErrorMessage message={error} />}
          <WorkspaceBanner role={user.role} label={activeLabel} />
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>FYP Compass</span>
          <span>
            <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
          </span>
        </footer>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Sign out of your workspace?"
        description="You can sign in again whenever you’re ready to continue."
        onConfirm={() => void logout()}
        busy={busy}
      />
    </div>
  );
}

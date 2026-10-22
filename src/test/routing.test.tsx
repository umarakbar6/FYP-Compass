import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';
import { roles, roleLabel } from '../types/shared';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
function portal(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}
describe('role routing and local demo sessions', () => {
  it('redirects an unauthenticated deep link to login', async () => {
    portal('/supervisor/milestones');
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
  });
  it.each(roles)('opens the %s workspace from demo access', async (role) => {
    portal();
    await userEvent.click(await screen.findByRole('button', { name: roleLabel[role] }));
    expect(await screen.findByText(`${roleLabel[role]} workspace`)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });
  it('restores a demo session and redirects another role’s deep link', async () => {
    sessionStorage.setItem('fyp-compass.demo-role', 'student');
    portal('/coordinator/reports');
    expect(
      await screen.findByRole('heading', { name: 'Your next big idea starts here.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reports' })).not.toBeInTheDocument();
  });
  it('ignores invalid persisted roles', async () => {
    sessionStorage.setItem('fyp-compass.demo-role', 'admin');
    portal('/student/dashboard');
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
  });
  it('opens student notices and returns to the overview', async () => {
    sessionStorage.setItem('fyp-compass.demo-role', 'student');
    portal('/student/notices');
    expect(await screen.findByRole('heading', { name: 'My notices' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to overview' }));
    expect(
      await screen.findByRole('heading', { name: 'Your next big idea starts here.' }),
    ).toBeInTheDocument();
  });
  it('requires logout confirmation and removes the local session', async () => {
    sessionStorage.setItem('fyp-compass.demo-role', 'supervisor');
    portal('/supervisor/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Supervisor workspace')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
    expect(sessionStorage.getItem('fyp-compass.demo-role')).toBeNull();
  });
});

it.each([
  '/student/configuration',
  '/student/matching',
  '/student/reports',
  '/student/health',
  '/supervisor/configuration',
  '/supervisor/matching',
  '/supervisor/reports',
])('blocks an unauthorized module inside the actor role prefix: %s', async (path) => {
  const role = path.split('/')[1];
  sessionStorage.setItem('fyp-compass.demo-role', role);
  portal(path);
  expect(
    await screen.findByRole('heading', {
      name:
        role === 'student' ? 'Your next big idea starts here.' : 'Guide ideas into great projects.',
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText('LIVE BACKEND MODULE')).not.toBeInTheDocument();
});

it('an unknown workspace route shows a real not-found state rather than an unfinished phase', async () => {
  sessionStorage.setItem('fyp-compass.demo-role', 'student');
  portal('/student/unknown-page');
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  expect(
    screen.queryByText(/Upcoming module|placeholder in Phase 1|Partner’s module/),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Back to overview' }));
  expect(
    await screen.findByRole('heading', { name: 'Your next big idea starts here.' }),
  ).toBeInTheDocument();
});

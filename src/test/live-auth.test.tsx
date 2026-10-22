import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';

const live = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  single: vi.fn(),
  rpc: vi.fn(),
  callback: null as
    null | ((event: string, session: { user: { id: string; email: string } } | null) => void),
}));
vi.mock('../lib/supabase', () => ({
  demoEnabled: false,
  backendError: null,
  supabase: {
    rpc: live.rpc,
    auth: {
      getSession: live.getSession,
      signInWithPassword: live.signInWithPassword,
      signOut: live.signOut,
      onAuthStateChange: (callback: typeof live.callback) => {
        live.callback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                live.callback = null;
              },
            },
          },
        };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: live.single }) }) }),
  },
}));
const authUser = { id: 'real-account-id', email: 'student@university.edu' };
beforeEach(() => {
  vi.clearAllMocks();
  live.getSession.mockResolvedValue({ data: { session: null }, error: null });
  live.rpc.mockImplementation(async (name) => ({
    data:
      name === 'fyp_security_context'
        ? {
            actor_id: authUser.id,
            mfa_required: false,
            has_verified_factor: false,
            staff_mfa_required: false,
            demo_access_enabled: true,
            is_owner: false,
            version: 1,
          }
        : name === 'get_milestone_workspace'
          ? { actor_id: authUser.id, projects: [] }
          : {
              session: null,
              topics: [],
              supervisors: [],
              eligible_members: [],
              group: null,
              proposal: null,
              allocation: null,
            },
    error: null,
  }));
  live.single.mockResolvedValue({
    data: { id: authUser.id, full_name: 'Real Student', role: 'student' },
    error: null,
  });
  live.signInWithPassword.mockImplementation(async () => {
    live.callback?.('SIGNED_IN', { user: authUser });
    return { data: { user: authUser }, error: null };
  });
  live.signOut.mockResolvedValue({ error: null });
});
function portal(path = '/login') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}
async function login() {
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Email address'));
  await user.paste(authUser.email);
  await user.click(screen.getByLabelText('Password', { exact: true }));
  await user.paste('test-password');
  await user.click(screen.getByRole('button', { name: 'Sign in to your workspace' }));
}
it('uses the profile role for real sign-in and hides local demo access', async () => {
  portal();
  await login();
  expect(await screen.findByText('Student workspace')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Coordinator' })).not.toBeInTheDocument();
  expect(live.signInWithPassword).toHaveBeenCalledWith({
    email: authUser.email,
    password: 'test-password',
  });
});
it('shows invalid-credential errors without opening a workspace', async () => {
  live.signInWithPassword.mockResolvedValue({
    data: { user: null },
    error: { message: 'Invalid login credentials' },
  });
  portal();
  await login();
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
});
it('fails closed when the account has an invalid role', async () => {
  live.single.mockResolvedValue({
    data: { id: authUser.id, full_name: 'Unknown User', role: 'admin' },
    error: null,
  });
  portal();
  await login();
  expect(await screen.findByRole('alert')).toHaveTextContent('no accessible role profile');
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
});
it('restores a backend session and prevents access to another role’s route', async () => {
  live.getSession.mockResolvedValue({ data: { session: { user: authUser } }, error: null });
  portal('/examiner/defenses');
  expect(
    await screen.findByRole('heading', { name: 'Your next big idea starts here.' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Assigned defenses' })).not.toBeInTheDocument();
});

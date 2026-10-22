import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';

vi.mock('../lib/backend-version', () => ({
  localBackend: true,
  coreV2: false,
  rpcName: (name: string) => name,
  submissionBucket: 'fyp-v2-submissions',
}));
vi.mock('../core/LocalAccountPicker', () => ({
  LocalAccountPicker: () => <p>Local account directory</p>,
}));
vi.mock('../lib/supabase', () => ({
  demoEnabled: false,
  backendError: null,
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'local-user', email: 'local@example.test' } } },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { message: 'Profile unavailable' } }),
        }),
      }),
    }),
  },
}));

it('shows a failed role-profile resolution in the local login screen with its account picker still available', async () => {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('no accessible role profile');
  expect(screen.getByText('Local account directory')).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
});

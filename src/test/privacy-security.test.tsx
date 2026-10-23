import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { privacyRequest } from '../privacy/api';
import { PrivacyRequests } from '../privacy/PrivacyRequests';
const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  user: { id: 'student-one', role: 'student' },
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: state.getSession } } }));
vi.mock('../lib/backend-version', () => ({ localBackend: false }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: state.user }) }));
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://ownedproject.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'synthetic-public-key');
  state.getSession.mockResolvedValue({
    data: { session: { user: { id: 'student-one' }, access_token: 'synthetic-token' } },
    error: null,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('binds each private data request to the approving token and does not accept arbitrary RPC names', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal('fetch', fetcher);
  await privacyRequest(
    'fyp_privacy_submit',
    { p_kind: 'deletion', p_detail: 'Review my own account.', p_confirm: true },
    'student-one',
  );
  expect(fetcher).toHaveBeenCalledWith(
    new URL('https://ownedproject.supabase.co/rest/v1/rpc/fyp_privacy_submit'),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }),
    }),
  );
  await expect(privacyRequest('fyp_v2_core_configure', {}, 'student-one')).rejects.toThrow(
    'unavailable',
  );
  expect(fetcher).toHaveBeenCalledOnce();
});
it('a switched session or stale approving view cannot dispatch another account request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(privacyRequest('fyp_privacy_submit', {}, 'another-account')).rejects.toThrow(
    'session changed',
  );
  await expect(
    privacyRequest('fyp_privacy_submit', {}, 'student-one', () => false),
  ).rejects.toThrow('session changed');
  expect(fetcher).not.toHaveBeenCalled();
});
it('renders stored injection text safely and requires explicit confirmation without offering student review controls', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      {
        id: 'request-one',
        kind: 'deletion',
        detail: malicious,
        status: 'requested',
        response: '',
        version: 1,
        created_at: '2026-10-16T01:00:00Z',
        requester_name: 'Student One',
      },
    ],
  });
  vi.stubGlobal('fetch', fetcher);
  const events = userEvent.setup();
  const { container } = render(<PrivacyRequests />);
  await screen.findByText(malicious);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record response' })).not.toBeInTheDocument();
  await events.type(screen.getByLabelText('Request details'), 'Please review my stored data.');
  expect(screen.getByRole('button', { name: 'Save data request' })).toBeDisabled();
  await events.click(screen.getByRole('checkbox'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save data request' })).toBeEnabled(),
  );
  expect(fetcher).toHaveBeenCalledOnce();
});

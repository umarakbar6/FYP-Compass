import { normaliseTotpQr } from '../security/mfa-qr';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MfaBoundary,
  AuthenticatorPanel,
  AccountSecurity,
  validateSecurityContext,
} from '../security/AccountSecurity';
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  verify: vi.fn(),
  signOut: vi.fn(),
  user: { id: 'account-a', role: 'student', full_name: 'Student', email: 'a@example.test' },
}));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: state.user, signOut: state.signOut }),
}));
vi.mock('../lib/backend-version', () => ({ localBackend: false }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: state.rpc,
    auth: {
      signOut: state.signOut,
      mfa: {
        listFactors: state.listFactors,
        enroll: state.enroll,
        unenroll: state.unenroll,
        challengeAndVerify: state.verify,
      },
    },
  },
}));
const context = (extra = {}) => ({
  actor_id: state.user.id,
  mfa_required: false,
  has_verified_factor: false,
  staff_mfa_required: false,
  demo_access_enabled: true,
  is_owner: false,
  version: 1,
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'account-a', role: 'student', full_name: 'Student', email: 'a@example.test' };
  state.rpc.mockImplementation(async () => ({ data: context(), error: null }));
  state.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  state.signOut.mockResolvedValue({ error: null });
});
it('rejects mismatched actors and malformed security fields', () => {
  expect(() => validateSecurityContext(context({ actor_id: 'another' }), 'account-a')).toThrow();
  expect(() => validateSecurityContext(context({ mfa_required: 'false' }), 'account-a')).toThrow();
  expect(() => validateSecurityContext(context({ version: NaN }), 'account-a')).toThrow();
});
it('never renders project records before a security response or after a failed check', async () => {
  let resolve!: (v: unknown) => void;
  state.rpc.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(
    <MfaBoundary>
      <p>Private project</p>
    </MfaBoundary>,
  );
  expect(screen.queryByText('Private project')).not.toBeInTheDocument();
  await act(async () => resolve({ data: null, error: { message: 'Unavailable' } }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
  expect(screen.queryByText('Private project')).not.toBeInTheDocument();
  state.rpc.mockResolvedValue({ data: context(), error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Retry security check' }));
  expect(await screen.findByText('Private project')).toBeInTheDocument();
});
it('mandatory MFA holds back project data and never enrols a credential automatically', async () => {
  state.rpc.mockResolvedValue({ data: context({ mfa_required: true }), error: null });
  render(
    <MfaBoundary>
      <p>Private project</p>
    </MfaBoundary>,
  );
  expect(await screen.findByRole('button', { name: 'Set up authenticator' })).toBeInTheDocument();
  expect(state.enroll).not.toHaveBeenCalled();
  expect(screen.queryByText('Private project')).not.toBeInTheDocument();
});
it('wrong authenticator codes never release the workspace and are cleared for retry', async () => {
  state.rpc.mockResolvedValue({
    data: context({ mfa_required: true, has_verified_factor: true }),
    error: null,
  });
  state.listFactors.mockResolvedValue({
    data: { totp: [{ id: 'factor-a', status: 'verified' }] },
    error: null,
  });
  state.verify.mockResolvedValue({ error: { message: 'Invalid OTP' } });
  render(
    <MfaBoundary>
      <p>Private project</p>
    </MfaBoundary>,
  );
  const input = await screen.findByLabelText('Authenticator code');
  fireEvent.change(input, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not accepted');
  expect(input).toHaveValue('');
  expect(screen.queryByText('Private project')).not.toBeInTheDocument();
});
it('verified challenge rechecks server context before releasing data', async () => {
  let verified = false;
  state.rpc.mockImplementation(async () => ({
    data: context({ mfa_required: !verified, has_verified_factor: true }),
    error: null,
  }));
  state.listFactors.mockResolvedValue({
    data: { totp: [{ id: 'factor-a', status: 'verified' }] },
    error: null,
  });
  state.verify.mockImplementation(async () => {
    verified = true;
    return { error: null };
  });
  render(
    <MfaBoundary>
      <p>Private project</p>
    </MfaBoundary>,
  );
  fireEvent.change(await screen.findByLabelText('Authenticator code'), {
    target: { value: '654321' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
  expect(await screen.findByText('Private project')).toBeInTheDocument();
  expect(state.verify).toHaveBeenCalledWith({ factorId: 'factor-a', code: '654321' });
  expect(state.rpc.mock.calls.length).toBeGreaterThanOrEqual(2);
});
it('late responses from a previous account cannot unlock the new account', async () => {
  let first!: (v: unknown) => void;
  state.rpc.mockReturnValueOnce(
    new Promise((r) => {
      first = r;
    }),
  );
  const tree = render(
    <MfaBoundary>
      <p>Private project</p>
    </MfaBoundary>,
  );
  state.user = { ...state.user, id: 'account-b' };
  state.rpc.mockResolvedValue({ data: context({ mfa_required: true }), error: null });
  tree.rerender(
    <MfaBoundary>
      <p>Private project</p>
    </MfaBoundary>,
  );
  await screen.findByText('Protect your workspace');
  await act(async () => first({ data: { ...context(), actor_id: 'account-a' }, error: null }));
  expect(screen.queryByText('Private project')).not.toBeInTheDocument();
});
it('enrolment requires an explicit click and never renders a malformed QR source', async () => {
  state.enroll.mockResolvedValue({
    data: { id: 'pending', totp: { qr_code: 'javascript:alert(1)' } },
    error: null,
  });
  render(<AuthenticatorPanel onVerified={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('QR code is invalid');
  expect(screen.queryByAltText('Private authenticator setup QR code')).not.toBeInTheDocument();
});
it('account security catches failed other-device revocations without claiming success', async () => {
  state.signOut.mockRejectedValue(new Error('Network down'));
  render(<AccountSecurity />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out other devices' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network down'));
  expect(screen.queryByText('Other device sessions have been revoked.')).not.toBeInTheDocument();
  expect(state.signOut).toHaveBeenCalledWith({ scope: 'others' });
});

it('an unfinished authenticator setup can be cleared explicitly before restarting', async () => {
  state.listFactors.mockResolvedValue({
    data: { totp: [], all: [{ id: 'unfinished', factor_type: 'totp', status: 'unverified' }] },
    error: null,
  });
  state.unenroll.mockResolvedValue({ error: null });
  render(<AuthenticatorPanel onVerified={vi.fn()} />);
  const clear = await screen.findByRole('button', { name: 'Clear unfinished setup' });
  expect(screen.queryByRole('button', { name: 'Set up authenticator' })).not.toBeInTheDocument();
  fireEvent.click(clear);
  expect(await screen.findByRole('button', { name: 'Set up authenticator' })).toBeInTheDocument();
  expect(state.unenroll).toHaveBeenCalledWith({ factorId: 'unfinished' });
  expect(state.enroll).not.toHaveBeenCalled();
});

it('accepts raw, unescaped SDK, encoded and base64 SVG QR formats above 100 KB', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/><!--' +
    'x'.repeat(150000) +
    '--></svg>';
  for (const value of [
    svg,
    'data:image/svg+xml;utf-8,' + svg,
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    'data:image/svg+xml;base64,' + btoa(svg),
  ])
    expect(normaliseTotpQr(value)).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
});
it.each([
  'javascript:alert(1)',
  '<html/>',
  '<svg xmlns="http://www.w3.org/2000/svg"><script>run()</script></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://outside.test/"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" onload="run()"/>',
  '<svg><rect style="fill:url(https://outside.test/x)"/></svg>',
])('rejects unsafe QR content', (value) => {
  expect(() => normaliseTotpQr(value)).toThrow('QR code is invalid');
});

it.each([
  '<!DOCTYPE svg [<!ENTITY bad "blocked">]><svg/>',
  '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://outside.test/x";</style></svg>',
  '<?xml-stylesheet href="https://outside.test/x"?><svg/>',
])('rejects SVG entity and stylesheet loads before rendering', (value) => {
  expect(() => normaliseTotpQr(value)).toThrow('QR code is invalid');
});

it('rejects setup-key and QR-reader paste instead of extracting misleading digits', async () => {
  state.listFactors.mockResolvedValue({
    data: { totp: [{ id: 'factor-a', status: 'verified' }] },
    error: null,
  });
  render(<AuthenticatorPanel onVerified={vi.fn()} />);
  const input = await screen.findByLabelText('Authenticator code');
  for (const text of ['EXAMPLE-SETUP-KEY-2-TEST', 'otpauth://totp/Example?secret=FAKE2TEST']) {
    fireEvent.paste(input, { clipboardData: { getData: () => text } });
    expect(input).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('Do not paste a setup key');
    expect(screen.getByRole('button', { name: 'Verify authenticator' })).toBeDisabled();
  }
  fireEvent.change(input, { target: { value: 'ABC2' } });
  expect(input).toHaveValue('');
  expect(state.verify).not.toHaveBeenCalled();
});
it('accepts a copied six digit app code with spacing and submits only the digits', async () => {
  state.listFactors.mockResolvedValue({
    data: { totp: [{ id: 'factor-a', status: 'verified' }] },
    error: null,
  });
  state.verify.mockResolvedValue({ error: null });
  const onVerified = vi.fn();
  render(<AuthenticatorPanel onVerified={onVerified} />);
  const input = await screen.findByLabelText('Authenticator code');
  fireEvent.paste(input, { clipboardData: { getData: () => '123 456\n' } });
  expect(input).toHaveValue('123456');
  fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
  await waitFor(() => expect(onVerified).toHaveBeenCalledOnce());
  expect(state.verify).toHaveBeenCalledWith({ factorId: 'factor-a', code: '123456' });
  expect(input).toHaveValue('');
});

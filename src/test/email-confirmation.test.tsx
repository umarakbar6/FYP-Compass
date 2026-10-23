import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmStudentEmail } from '../auth/RegistrationPages';
import { verifyStudentEmailCode } from '../auth/registration';

const live = vi.hoisted(() => ({ verifyOtp: vi.fn(), resend: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: live }, demoEnabled: false }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: null, loading: false, error: null }),
}));
const confirmed = () => ({
  data: {
    session: { access_token: 'synthetic-session' },
    user: { email_confirmed_at: '2026-10-23T12:00:00Z' },
  },
  error: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/auth/confirm');
  live.verifyOtp.mockResolvedValue(confirmed());
  live.resend.mockResolvedValue({ error: null });
});
afterEach(() => window.history.replaceState({}, '', '/'));

it('requests a fresh code without repeating registration and does not delay verification', async () => {
  render(
    <MemoryRouter>
      <ConfirmStudentEmail />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'student@example.com' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send a new verification email' }));
  });
  expect(live.resend).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'signup', email: 'student@example.com' }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('If this account needs confirmation');
  expect(screen.getByRole('button', { name: /Resend available in/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Email verification code'), {
    target: { value: '123456' },
  });
  expect(screen.getByRole('button', { name: 'Confirm email' })).toBeEnabled();
});

it('a failed resend shows its error rather than claiming a new email was sent', async () => {
  live.resend.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', status: 429 } });
  render(
    <MemoryRouter>
      <ConfirmStudentEmail />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'student@example.com' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send a new verification email' }));
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry available in 300s' })).toBeDisabled();
  expect(screen.getByText(/hourly limit/)).toBeInTheDocument();
});

it('verifies only a signup email code with normalized email and no privileged fields', async () => {
  await verifyStudentEmailCode(' Student@Example.com ', ' 123456 ');
  expect(live.verifyOtp).toHaveBeenCalledWith({
    email: 'student@example.com',
    token: '123456',
    type: 'signup',
  });
});
it.each([
  ['invalid', '123456'],
  ['student@example.com', '12345'],
  ['student@example.com', '12ab56'],
  ['student@example.com', '12345678901'],
])('blocks malformed email/code before the API request: %s %s', async (email, code) => {
  await expect(verifyStudentEmailCode(email, code)).rejects.toThrow();
  expect(live.verifyOtp).not.toHaveBeenCalled();
});
it('does not expose backend internals when a code is expired or incorrect', async () => {
  live.verifyOtp.mockResolvedValue({
    data: { session: null, user: null },
    error: { message: 'private auth details', code: 'otp_expired' },
  });
  await expect(verifyStudentEmailCode('student@example.com', '123456')).rejects.toThrow(
    'incorrect, expired or already used',
  );
});
it.each([
  { session: null, user: { email_confirmed_at: '2026-10-23' } },
  { session: {}, user: {} },
])('never claims verification succeeded without a verified session: %j', async (data) => {
  live.verifyOtp.mockResolvedValue({ data, error: null });
  await expect(verifyStudentEmailCode('student@example.com', '123456')).rejects.toThrow();
});
it('provides a bounded wait on verification rate limits', async () => {
  live.verifyOtp.mockResolvedValue({ data: {}, error: { status: 429 } });
  await expect(verifyStudentEmailCode('student@example.com', '123456')).rejects.toMatchObject({
    retryDelaySeconds: 300,
  });
});
it('keeps the code alternative usable after an expired email link and requires explicit submission', async () => {
  window.history.replaceState({}, '', '/auth/confirm?error=access_denied');
  render(
    <MemoryRouter>
      <ConfirmStudentEmail />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { name: 'This verification link is unavailable' }),
  ).toBeInTheDocument();
  expect(live.verifyOtp).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm email' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'student@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Email verification code'), {
    target: { value: '123456' },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm email' }).closest('form')!);
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Your email is verified');
  expect(screen.queryByLabelText('Email verification code')).not.toBeInTheDocument();
});
it('prevents duplicate requests while verification is pending', async () => {
  let finish!: (value: ReturnType<typeof confirmed>) => void;
  live.verifyOtp.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <MemoryRouter>
      <ConfirmStudentEmail />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'student@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Email verification code'), {
    target: { value: '123456' },
  });
  const form = screen.getByRole('button', { name: 'Confirm email' }).closest('form')!;
  await act(async () => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(live.verifyOtp).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(confirmed());
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Your email is verified');
});

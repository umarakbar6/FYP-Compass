import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { StudentRegistrationPage, ConfirmStudentEmail } from '../auth/RegistrationPages';
import {
  registerStudent,
  RegistrationRequestError,
  resendStudentConfirmation,
  validateRegistration,
} from '../auth/registration';

const live = vi.hoisted(() => ({ signUp: vi.fn(), resend: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: live }, demoEnabled: false }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: null, loading: false, error: null }),
}));
vi.mock('../lib/deployment', () => ({
  applicationOrigin: () => 'https://fyp-compass-ten.vercel.app',
}));
const valid = () => ({
  fullName: '  Real Student  ',
  email: 'Student@Example.com ',
  password: 'A unique password 42!',
  confirmPassword: 'A unique password 42!',
  acceptedTerms: true,
});
beforeEach(() => {
  vi.clearAllMocks();
  live.signUp.mockResolvedValue({ data: { session: null, user: { id: 'new-user' } }, error: null });
  live.resend.mockResolvedValue({ error: null });
});

it('public signup sends normalized identity and password without privileged role or auto-confirm flags', async () => {
  expect(await registerStudent(valid())).toEqual({
    email: 'student@example.com',
    verificationRequired: true,
  });
  expect(live.signUp).toHaveBeenCalledWith({
    email: 'student@example.com',
    password: valid().password,
    options: {
      emailRedirectTo: 'https://fyp-compass-ten.vercel.app/auth/confirm',
      data: { full_name: 'Real Student', registration_source: 'student_self_service_v1' },
    },
  });
});
it.each([
  { fullName: '' },
  { email: 'bad' },
  { password: 'short' },
  { confirmPassword: 'different' },
  { acceptedTerms: false },
  { fullName: 'x'.repeat(121) },
])('rejects invalid signup input before sending a request: %j', async (change) => {
  expect(() => validateRegistration({ ...valid(), ...change })).toThrow();
  await expect(registerStudent({ ...valid(), ...change })).rejects.toThrow();
  expect(live.signUp).not.toHaveBeenCalled();
});
it('does not reveal raw backend errors, internal records or passwords on signup failure', async () => {
  live.signUp.mockResolvedValue({
    data: {},
    error: { code: 'unexpected_failure', message: 'Database error with private internals' },
  });
  await expect(registerStudent(valid())).rejects.toThrow('Registration could not be completed');
});
it.each([registerStudent, () => resendStudentConfirmation(valid().email)])(
  'explains the project hourly email quota and provides a bounded retry pause',
  async (request) => {
    const failure = { data: {}, error: { code: 'over_email_send_rate_limit', status: 429 } };
    live.signUp.mockResolvedValue(failure);
    live.resend.mockResolvedValue(failure);
    await expect(request(valid())).rejects.toMatchObject({
      name: 'RegistrationRequestError',
      message: expect.stringContaining('hourly limit'),
      retryDelaySeconds: 300,
    });
  },
);
it.each([{ code: 'over_request_rate_limit' }, { status: 429 }])(
  'handles other throttles without incorrectly claiming the email quota is exhausted: %j',
  async (error) => {
    live.signUp.mockResolvedValue({ data: {}, error });
    await expect(registerStudent(valid())).rejects.toMatchObject({
      message: expect.stringContaining('Too many authentication requests'),
      retryDelaySeconds: 300,
    });
  },
);
it('resends only a signup verification link with the fixed confirmation route', async () => {
  await resendStudentConfirmation(' Student@Example.com ');
  expect(live.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'student@example.com',
    options: { emailRedirectTo: 'https://fyp-compass-ten.vercel.app/auth/confirm' },
  });
});
it('shows the complete registration form and a verification screen without a role selector', async () => {
  render(
    <MemoryRouter>
      <StudentRegistrationPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Full name'), 'Real Student');
  await user.type(screen.getByLabelText('Email address'), 'student@example.com');
  await user.type(screen.getByLabelText('Password', { exact: true }), valid().password);
  await user.type(screen.getByLabelText('Confirm password'), valid().password);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Create student account' }));
  expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Resend available in/ })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
});
it('expired or absent verification sessions offer a clear next step without opening a private workspace', () => {
  render(
    <MemoryRouter>
      <ConfirmStudentEmail />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Email verification' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
});

it('preserves signup input, blocks repeated submissions during a throttle and permits a retry afterwards', async () => {
  vi.useFakeTimers();
  try {
    live.signUp.mockResolvedValueOnce({
      data: {},
      error: { code: 'over_email_send_rate_limit', status: 429 },
    });
    render(
      <MemoryRouter>
        <StudentRegistrationPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Real Student' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: valid().password },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: valid().password },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    const form = screen.getByRole('button', { name: 'Create student account' }).closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(/Verification emails have reached/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue('student@example.com');
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue(valid().password);
    expect(screen.getByRole('button', { name: 'Retry available in 300s' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(live.signUp).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(300_000);
    });
    expect(screen.getByRole('button', { name: 'Create student account' })).toBeEnabled();
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(live.signUp).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it('rate limit errors remain safe Error instances with an explicit retry delay', () => {
  const error = new RegistrationRequestError('Safe message', 300);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('Safe message');
  expect(error.retryDelaySeconds).toBe(300);
});

it('a throttled resend shows no success notice and starts a retry pause', async () => {
  vi.useFakeTimers();
  try {
    live.resend.mockResolvedValueOnce({
      error: { code: 'over_email_send_rate_limit', status: 429 },
    });
    render(
      <MemoryRouter>
        <StudentRegistrationPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Real Student' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: valid().password },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: valid().password },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create student account' }));
    });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    });
    expect(live.resend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Resend available in 300s' })).toBeDisabled();
    expect(screen.getByText(/Verification emails have reached/)).toBeInTheDocument();
    expect(screen.queryByText(/a new email has been requested/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resend available in 300s' }));
    expect(live.resend).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

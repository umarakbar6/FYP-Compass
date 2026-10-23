import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth }, demoEnabled: false }));
vi.mock('../lib/deployment', () => ({
  applicationOrigin: () => 'https://fyp-compass-ten.vercel.app',
  supportEmail: '',
}));
beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0xPUBLIC_WIDGET_TEST_KEY');
  vi.resetModules();
  vi.clearAllMocks();
  auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
  auth.resend.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({
    data: { session: {}, user: { email_confirmed_at: '2026-10-23' } },
    error: null,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.turnstile;
});
const valid = {
  fullName: 'Test Student',
  email: 'student@example.test',
  password: 'A strong unique pass42!',
  confirmPassword: 'A strong unique pass42!',
  acceptedTerms: true,
};
it('email-code confirmation requires CAPTCHA proof and propagates it without privilege fields', async () => {
  const { verifyStudentEmailCode } = await import('../auth/registration');
  await expect(verifyStudentEmailCode(valid.email, '123456')).rejects.toThrow(
    'Complete the security verification',
  );
  await expect(verifyStudentEmailCode(valid.email, '123456', 'x'.repeat(2049))).rejects.toThrow(
    'Complete the security verification',
  );
  expect(auth.verifyOtp).not.toHaveBeenCalled();
  await verifyStudentEmailCode(valid.email, '123456', 'fresh-verification-proof');
  expect(auth.verifyOtp).toHaveBeenCalledWith({
    email: valid.email,
    token: '123456',
    type: 'signup',
    options: { captchaToken: 'fresh-verification-proof' },
  });
});
it('configured CAPTCHA rejects missing and oversized tokens before signup or resend', async () => {
  const { registerStudent, resendStudentConfirmation } = await import('../auth/registration');
  await expect(registerStudent(valid)).rejects.toThrow('Complete the security verification');
  await expect(registerStudent(valid, 'x'.repeat(2049))).rejects.toThrow(
    'Complete the security verification',
  );
  await expect(resendStudentConfirmation(valid.email)).rejects.toThrow(
    'Complete the security verification',
  );
  expect(auth.signUp).not.toHaveBeenCalled();
  expect(auth.resend).not.toHaveBeenCalled();
});
it('signup and resend propagate the token through Supabase options without assigning a privileged role', async () => {
  const { registerStudent, resendStudentConfirmation } = await import('../auth/registration');
  await registerStudent(valid, 'fresh-signup-proof');
  await resendStudentConfirmation(valid.email, 'fresh-resend-proof');
  expect(auth.signUp.mock.calls[0][0].options.captchaToken).toBe('fresh-signup-proof');
  expect(auth.signUp.mock.calls[0][0].options.data.role).toBeUndefined();
  expect(auth.resend.mock.calls[0][0].options.captchaToken).toBe('fresh-resend-proof');
});
it('the widget clears expired and failed proof, and removes old widget instances on revision', async () => {
  let settings: Record<string, unknown> = {};
  const remove = vi.fn();
  window.turnstile = {
    render: vi.fn((_node, options) => {
      settings = options;
      return 'widget-one';
    }),
    remove,
  };
  const token = vi.fn();
  const { Turnstile: ActiveWidget } = await import('../engagement/Turnstile');
  const active = render(<ActiveWidget action="login" onToken={token} revision={0} />);
  expect(settings.action).toBe('login');
  (settings.callback as (x: string) => void)('fresh-token');
  (settings['expired-callback'] as () => void)();
  (settings['error-callback'] as () => void)();
  expect(token.mock.calls.slice(-3)).toEqual([['fresh-token'], [''], ['']]);
  active.rerender(<ActiveWidget action="login" onToken={token} revision={1} />);
  expect(remove).toHaveBeenCalledWith('widget-one');
  active.unmount();
});
it('password recovery stays disabled without proof and sends a fresh token once verified', async () => {
  let solve: (x: string) => void = () => {};
  window.turnstile = {
    render: vi.fn((_node, options) => {
      solve = options.callback as typeof solve;
      return 'recovery-proof';
    }),
    remove: vi.fn(),
  };
  const { ForgotPassword } = await import('../auth/RecoveryPages');
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'student@example.test' },
  });
  const submit = screen.getByRole('button', { name: 'Send recovery link' });
  expect(submit).toBeDisabled();
  fireEvent.submit(submit.closest('form')!);
  expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  const { act } = await import('@testing-library/react');
  await act(async () => solve('fresh-recovery-proof'));
  fireEvent.click(submit);
  await waitFor(() =>
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('student@example.test', {
      redirectTo: 'https://fyp-compass-ten.vercel.app/auth/reset',
      captchaToken: 'fresh-recovery-proof',
    }),
  );
});

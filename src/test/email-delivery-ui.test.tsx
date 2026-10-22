import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailDeliveryCheck } from '../operations/EmailDeliveryCheck';
const state = vi.hoisted(() => ({
  user: { id: 'coordinator-a', role: 'coordinator' },
  send: vi.fn(),
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('../operations/email-delivery', () => ({ deliverEmail: state.send }));
beforeEach(() => {
  vi.stubEnv('VITE_REMINDER_EMAIL_ENABLED', 'true');
  state.user = { id: 'coordinator-a', role: 'coordinator' };
  state.send.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it('requires explicit approval and locks a successfully sent diagnostic', async () => {
  const u = userEvent.setup();
  state.send.mockResolvedValue('00000000-0000-4000-8000-000000000001');
  render(<EmailDeliveryCheck />);
  const button = screen.getByRole('button', { name: 'Send email delivery check' });
  expect(button).toBeDisabled();
  await u.click(screen.getByRole('checkbox'));
  await u.click(button);
  expect(await screen.findByRole('status')).toHaveTextContent('accepted for delivery');
  expect(button).toBeDisabled();
  expect(state.send).toHaveBeenCalledOnce();
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'delivery_test', confirm: true }),
    'coordinator-a',
  );
});
it('does not expose the delivery test to a student', () => {
  state.user = { id: 'student-a', role: 'student' };
  render(<EmailDeliveryCheck />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(state.send).not.toHaveBeenCalled();
});
it('does not display an old account receipt after switching accounts during delivery', async () => {
  const u = userEvent.setup();
  let finish!: (value: string) => void;
  state.send.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<EmailDeliveryCheck key={state.user.id} />);
  await u.click(screen.getByRole('checkbox'));
  await u.click(screen.getByRole('button'));
  state.user = { id: 'coordinator-b', role: 'coordinator' };
  view.rerender(<EmailDeliveryCheck key={state.user.id} />);
  finish('00000000-0000-4000-8000-000000000001');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('explains non-deliverable demo mailboxes without enabling a real send', () => {
  Object.assign(state.user, { email: 'coordinator@demo.fypcompass.test' });
  render(<EmailDeliveryCheck />);
  expect(screen.getByText(/Demo accounts have no live mailbox/)).toBeInTheDocument();
  expect(screen.getByRole('button')).toBeDisabled();
  expect(state.send).not.toHaveBeenCalled();
});

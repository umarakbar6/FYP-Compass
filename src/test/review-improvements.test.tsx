import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { parseRoster } from '../operations/roster';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ForgotPassword, ResetPassword } from '../auth/RecoveryPages';
import { formatHealthEvidence } from '../health/format-evidence';
import { validateDraft, cosine, scheduleDraft, agentKinds } from '../../backend/agents/engine';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
it('CSV preview supports quoted names and rejects duplicate emails and coordinator roles', () => {
  expect(
    parseRoster('email,full_name,role\na@example.test,"Student, One",student')[0].full_name,
  ).toBe('Student, One');
  expect(() => parseRoster('email,full_name,role\na@example.test,Person,coordinator')).toThrow();
  expect(() =>
    parseRoster('email,full_name,role\na@example.test,One,student\nA@example.test,Two,student'),
  ).toThrow('Duplicate');
});
it('all nine drafting agents have a strict output schema and no executable actions', () => {
  expect(agentKinds).toHaveLength(9);
  expect(
    validateDraft({ summary: 'Draft', findings: [], actions: ['Review'], references: [] }),
  ).toBeTruthy();
  expect(() =>
    validateDraft({
      summary: 'Draft',
      findings: [],
      actions: [],
      references: [],
      execute: 'grade',
    }),
  ).toThrow();
});
it('cosine similarity is bounded and rejects invalid dimensions', () => {
  expect(cosine([1, 0], [1, 0])).toBe(1);
  expect(cosine([1, 0], [0, 1])).toBe(0);
  expect(() => cosine([1], [1, 2])).toThrow();
});
it('scheduler respects room/examiner/supervisor conflicts and does not schedule unready projects', () => {
  const p = {
    projects: [
      { id: 'g1', supervisor_id: 's1', ready: true },
      { id: 'g2', supervisor_id: 's2', ready: true },
      { id: 'g3', supervisor_id: 's3', ready: false },
    ],
    examiners: ['e1', 'e2'],
    rooms: ['A'],
    start: '2030-01-01T10:00:00Z',
    slots: 1,
    minutes: 60,
    existing: [],
  };
  const draft = scheduleDraft(p);
  expect(draft.proposed).toHaveLength(1);
  expect(draft.unresolved).toHaveLength(2);
  expect(() => scheduleDraft({ ...p, examiners: ['e1', 'e1'] })).toThrow();
});
it('error boundary renders recovery controls without exposing raw error details', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken() {
    throw Error('private-password');
    return null;
  }
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(
    screen.getByRole('heading', { name: 'We could not open this screen.' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('private-password')).not.toBeInTheDocument();
  spy.mockRestore();
});
it('recovery request has a usable email field and invalid recovery cannot change a password', () => {
  const { unmount } = render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  unmount();
  render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: 'Save password' })).toBeDisabled();
});
it('health evidence presents dates without mutating the raw evidence', () => {
  const original = 'deadline 2026-10-10T12:00:00Z';
  expect(formatHealthEvidence(original)).not.toContain('2026-10-10T');
  expect(original).toContain('2026-10-10T');
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';
import { calculateHealth } from '../health/rules';
import { generateHealthText, validateHealthText } from '../health/agent';
import {
  createHealthDraft,
  loadHealthWorkspace,
  reviewHealthDraft,
  markHealthNoticeRead,
  validateHealthWorkspace,
} from '../health/api';
import { initialMilestoneProjects } from '../lib/milestone-api';
import type { PortalUser } from '../types/shared';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
const supervisor: PortalUser = {
  id: 'demo-supervisor',
  role: 'supervisor',
  full_name: 'Supervisor',
  email: 's@demo.local',
};
const student: PortalUser = {
  id: 'demo-student',
  role: 'student',
  full_name: 'Student',
  email: 'a@demo.local',
};
const now = Date.parse('2026-10-06T12:00:00Z');
function project() {
  const p = initialMilestoneProjects()[0];
  p.milestones = [];
  return p;
}
function input(p = project()) {
  return { project_id: p.id, peers_required: false, peers: [] };
}
it('calculates repeatable Green, Amber and Red with fixed timestamps', () => {
  const p = project();
  expect(calculateHealth(p, input(p), now).level).toBe('green');
  const item = initialMilestoneProjects()[0].milestones[1];
  item.deadline = new Date(now + 86400000).toISOString();
  p.milestones = [item];
  expect(calculateHealth(p, input(p), now).level).toBe('amber');
  item.deadline = new Date(now - 1).toISOString();
  const red = calculateHealth(p, input(p), now);
  expect(red.level).toBe('red');
  expect(calculateHealth(p, input(p), now)).toEqual(red);
});
it('uses a strict overdue boundary and a three-day upcoming window', () => {
  const p = project();
  const m = initialMilestoneProjects()[0].milestones[1];
  p.milestones = [m];
  m.deadline = new Date(now).toISOString();
  expect(calculateHealth(p, input(p), now).rules[0].code).toBe('DEADLINE_UPCOMING');
  m.deadline = new Date(now + 3 * 86400000 + 1).toISOString();
  expect(calculateHealth(p, input(p), now).level).toBe('green');
});
it('detects late submissions, missing contributions and repeated rework', () => {
  const p = initialMilestoneProjects()[0];
  p.milestones = [p.milestones[0]];
  const m = p.milestones[0];
  m.deadline = new Date(now - 2 * 86400000).toISOString();
  m.submissions[0].submitted_at = new Date(now - 86400000).toISOString();
  m.submissions[0].contributions = [];
  m.submissions[0].review = {
    action: 'needs_rework',
    feedback: 'Revise',
    reviewer_id: supervisor.id,
    reviewed_at: new Date(now - 1000).toISOString(),
  };
  m.submissions.push(structuredClone(m.submissions[0]));
  m.status = 'needs_rework';
  const codes = calculateHealth(p, input(p), now).rules.map((r) => r.code);
  expect(codes).toEqual(
    expect.arrayContaining([
      'MILESTONE_LATE',
      'MILESTONE_OVERDUE',
      'CONTRIBUTIONS_MISSING',
      'REPEATED_REWORK',
    ]),
  );
});
it('detects missing peer ratings, low average, spread and contribution differences', () => {
  const p = project();
  const peers = [
    { member_id: p.members[0].id, ratings: [1, 3], supervisor_percent: 80 },
    { member_id: p.members[1].id, ratings: [1], supervisor_percent: 100 },
  ];
  const result = calculateHealth(p, { project_id: p.id, peers_required: true, peers }, now);
  expect(result.rules.map((r) => r.code)).toEqual(
    expect.arrayContaining([
      'PEER_RATINGS_MISSING',
      'PEER_AVERAGE_LOW',
      'PEER_RATING_SPREAD',
      'CONTRIBUTION_DIFFERENCE',
    ]),
  );
});
it('keeps exactly 2.5 average and exactly 30 percentage point difference outside strict rules', () => {
  const p = project();
  const peers = p.members.map((m) => ({
    member_id: m.id,
    ratings: [2.5, 2.5],
    supervisor_percent: 67.5,
  }));
  expect(calculateHealth(p, { project_id: p.id, peers_required: true, peers }, now).level).toBe(
    'green',
  );
});
it('rejects invalid dates, ratings, duplicate signals and unknown members', () => {
  const p = project();
  expect(() => calculateHealth(p, input(p), NaN)).toThrow(/invalid/);
  expect(() =>
    calculateHealth(
      p,
      { ...input(p), peers: [{ member_id: 'stranger', ratings: [6], supervisor_percent: null }] },
      now,
    ),
  ).toThrow(/invalid/);
  const s = { member_id: p.members[0].id, ratings: [3], supervisor_percent: 50 };
  expect(() => calculateHealth(p, { ...input(p), peers: [s, s] }, now)).toThrow(/unique/);
});
it('uses a fallback on provider failure and rejects AI risk overrides', async () => {
  const risk = calculateHealth(project(), input(), now);
  const before = structuredClone(risk);
  const output = await generateHealthText(risk, async (value) => {
    value.level = 'red';
    return { explanation: 'Changed', action: 'Act', message: 'Msg', level: 'red' };
  });
  expect(output.source).toBe('fallback');
  expect(risk).toEqual(before);
  expect(
    (
      await generateHealthText(risk, async () => {
        throw new Error('offline');
      })
    ).source,
  ).toBe('fallback');
  expect(
    (
      await generateHealthText(risk, async () => ({
        explanation: 'Clear',
        action: 'Continue',
        message: 'Stay on track',
      }))
    ).source,
  ).toBe('gemini');
});
it('hides drafts, publishes edited text to every member only on approval, and saves independent read state', async () => {
  const ws = await createHealthDraft(supervisor, 'demo-milestone-project');
  const report = ws.reports[0];
  expect((await loadHealthWorkspace(student)).notices).toHaveLength(0);
  expect((await loadHealthWorkspace(student)).reports).toHaveLength(0);
  const approved = await reviewHealthDraft(supervisor, report.id, report.version, 'approve', {
    explanation: report.explanation,
    action: report.action,
    message: 'Please meet your supervisor tomorrow.',
  });
  expect(approved.notices).toHaveLength(1);
  const notice = approved.notices[0];
  expect((await loadHealthWorkspace(student)).notices[0].body).toBe(
    'Please meet your supervisor tomorrow.',
  );
  await markHealthNoticeRead(student, notice.id);
  expect((await loadHealthWorkspace(student)).notices[0].read_by).toEqual([student.id]);
  const member = { ...student, id: 'student-farhan' };
  expect((await loadHealthWorkspace(member)).notices[0].read_by).toEqual([]);
  expect((await markHealthNoticeRead(member, notice.id)).notices[0].read_by).toEqual([member.id]);
  await expect(
    reviewHealthDraft(supervisor, report.id, report.version, 'approve', {
      explanation: report.explanation,
      action: report.action,
      message: report.message,
    }),
  ).rejects.toThrow();
});
it('rejects without publishing and prevents duplicate drafts and unauthorized actions', async () => {
  const ws = await createHealthDraft(supervisor, 'demo-milestone-project');
  const r = ws.reports[0];
  await expect(createHealthDraft(supervisor, r.project_id)).rejects.toThrow(/already exists/);
  const text = { explanation: r.explanation, action: r.action, message: r.message };
  await reviewHealthDraft(supervisor, r.id, r.version, 'reject', text);
  expect((await loadHealthWorkspace(student)).notices).toHaveLength(0);
  await expect(createHealthDraft(student, r.project_id)).rejects.toThrow(/supervisors/);
  await expect(
    createHealthDraft({ ...supervisor, id: 'other-supervisor' }, r.project_id),
  ).rejects.toThrow(/assigned/);
  await expect(markHealthNoticeRead(student, 'unknown')).rejects.toThrow(/not available/);
});
it('blocks stale approvals after evidence changes and rejects malformed storage', async () => {
  const ws = await createHealthDraft(supervisor, 'demo-milestone-project');
  const r = ws.reports[0];
  const projects = JSON.parse(localStorage.getItem('fyp-compass.milestones.v1')!);
  projects[0].milestones[1].deadline = new Date(Date.now() + 10 * 86400000).toISOString();
  localStorage.setItem('fyp-compass.milestones.v1', JSON.stringify(projects));
  await expect(
    reviewHealthDraft(supervisor, r.id, r.version, 'approve', {
      explanation: r.explanation,
      action: r.action,
      message: r.message,
    }),
  ).rejects.toThrow(/evidence changed/);
  localStorage.setItem('fyp-compass.health.v1', '{}');
  await expect(loadHealthWorkspace(supervisor)).rejects.toThrow(/invalid/);
});
it('rejects private drafts or another account in a student backend snapshot', async () => {
  const ws = await loadHealthWorkspace(student);
  expect(() => validateHealthWorkspace({ ...ws, actor_id: 'other' }, student)).toThrow(
    /different account/,
  );
  expect(() => validateHealthWorkspace({ ...ws, reports: [{}] }, student)).toThrow(/Private/);
  expect(() =>
    validateHealthWorkspace(
      { ...ws, projects: ws.projects.map((p) => ({ ...p, name: { invalid: true } })) },
      student,
    ),
  ).toThrow(/Private/);
});
it('supports supervisor editing and approval through the real route', async () => {
  sessionStorage.setItem('fyp-compass.demo-role', 'supervisor');
  render(
    <MemoryRouter initialEntries={['/supervisor/health']}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole(
      'button',
      { name: /Create draft for Team Compass/ },
      { timeout: 10000 },
    ),
  );
  const message = await screen.findByLabelText('Student message');
  await userEvent.clear(message);
  await userEvent.type(message, 'Bring your updated evidence to the review.');
  await userEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
  expect(
    await screen.findByText('Approved message published to all group members.'),
  ).toBeInTheDocument();
});

it('keeps individual peer evidence out of fallback student messages', async () => {
  const p = project();
  const risk = calculateHealth(
    p,
    {
      project_id: p.id,
      peers_required: true,
      peers: [{ member_id: p.members[0].id, ratings: [1, 3], supervisor_percent: 80 }],
    },
    now,
  );
  const output = await generateHealthText(risk);
  expect(output.explanation).toContain('Member 1');
  expect(output.message).not.toContain('Member 1');
  expect(output.message).not.toContain('80.00%');
  expect(output.message).toContain('supervisor review');
});
it('allows only one concurrent decision for the same report version', async () => {
  const ws = await createHealthDraft(supervisor, 'demo-milestone-project');
  const report = ws.reports[0];
  const text = { explanation: report.explanation, action: report.action, message: report.message };
  const results = await Promise.allSettled([
    reviewHealthDraft(supervisor, report.id, report.version, 'reject', text),
    reviewHealthDraft(supervisor, report.id, report.version, 'approve', text),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const latest = await loadHealthWorkspace(supervisor);
  expect(latest.reports[0].version).toBe(2);
  expect(latest.notices.length).toBeLessThanOrEqual(1);
});

it('keeps long fallback evidence within the report limit without altering saved rules', async () => {
  const risk = calculateHealth(project(), input(), now);
  risk.level = 'red';
  risk.rules = Array.from({ length: 60 }, (_, i) => ({
    code: 'MILESTONE_OVERDUE',
    level: 'red' as const,
    evidence: 'Milestone ' + i + ': ' + 'Outstanding evidence. '.repeat(10),
  }));
  const before = structuredClone(risk);
  const output = await generateHealthText(risk, async () => {
    throw new Error('offline');
  });
  expect(output.source).toBe('fallback');
  expect(output.explanation.length).toBeLessThanOrEqual(4000);
  expect(output.explanation).toContain('Additional evidence');
  expect(risk).toEqual(before);
  expect(() =>
    validateHealthText({
      explanation: output.explanation,
      action: output.action,
      message: output.message,
    }),
  ).not.toThrow();
});

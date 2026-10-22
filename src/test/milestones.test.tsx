import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';
import {
  loadMilestoneWorkspace,
  latestSubmission,
  milestoneTiming,
  submitMilestone,
  saveContribution,
  reviewMilestone,
  validateMilestoneWorkspace,
} from '../lib/milestone-api';
import type { PortalUser } from '../types/shared';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
const student: PortalUser = {
  id: 'demo-student',
  full_name: 'Ayesha Khan',
  role: 'student',
  email: 'student@demo.local',
};
const supervisor: PortalUser = {
  id: 'demo-supervisor',
  full_name: 'Dr. Ahmed Ali',
  role: 'supervisor',
  email: 'supervisor@demo.local',
};
const document = () =>
  new File(['milestone evidence'], 'prototype.pdf', { type: 'application/pdf' });
it('keeps timing independent of workflow, including exact deadline boundaries', async () => {
  const [plan, design, progress] = (await loadMilestoneWorkspace(student)).projects[0].milestones;
  expect(milestoneTiming(plan)).toBe('on_time');
  expect(milestoneTiming(design)).toBe('overdue');
  expect(milestoneTiming(progress)).toBe('late');
  expect(progress.status).toBe('accepted');
  expect(milestoneTiming({ ...design, deadline: new Date(1000).toISOString() }, 1000)).toBeNull();
  expect(milestoneTiming({ ...plan, deadline: latestSubmission(plan)!.submitted_at })).toBe(
    'on_time',
  );
});
it('requires a valid file and individual evidence, and locks duplicate submissions', async () => {
  await expect(
    submitMilestone(student, 'milestone-design', null, 'My evidence', null),
  ).rejects.toThrow(/Choose a PDF or DOCX file with content/);
  await expect(submitMilestone(student, 'milestone-design', document(), ' ', null)).rejects.toThrow(
    /individual contribution/,
  );
  await expect(
    submitMilestone(
      student,
      'milestone-design',
      new File(['bad'], 'code.exe'),
      'My evidence',
      null,
    ),
  ).rejects.toThrow(/PDF/);
  const workspace = await submitMilestone(
    student,
    'milestone-design',
    document(),
    'Designed the prototype and user journeys.',
    null,
  );
  const item = workspace.projects[0].milestones[1];
  expect(item.status).toBe('submitted');
  expect(milestoneTiming(item)).toBe('late');
  expect(latestSubmission(item)?.contributions).toHaveLength(1);
  await expect(submitMilestone(student, item.id, document(), 'Repeat', null)).rejects.toThrow(
    /locked/,
  );
});
it('shares reviews with students, preserves rework history, and rejects stale decisions', async () => {
  const original = (await loadMilestoneWorkspace(student)).projects[0].milestones[0];
  const originalId = latestSubmission(original)!.id;
  await expect(
    reviewMilestone(supervisor, original.id, originalId, 'needs_rework', ' '),
  ).rejects.toThrow(/feedback/);
  await reviewMilestone(
    supervisor,
    original.id,
    originalId,
    'needs_rework',
    'Add measurable evaluation criteria.',
  );
  const feedback = (await loadMilestoneWorkspace(student)).projects[0].milestones[0];
  expect(latestSubmission(feedback)?.review?.feedback).toContain('measurable');
  const revised = (
    await submitMilestone(
      student,
      original.id,
      document(),
      'Added evaluation criteria and test evidence.',
      originalId,
    )
  ).projects[0].milestones[0];
  expect(revised.submissions).toHaveLength(2);
  expect(revised.submissions[0].review?.action).toBe('needs_rework');
  expect(latestSubmission(revised)?.contributions).toHaveLength(1);
  await expect(
    reviewMilestone(supervisor, original.id, originalId, 'accepted', ''),
  ).rejects.toThrow(/changed/);
  const newId = latestSubmission(revised)!.id;
  await reviewMilestone(supervisor, original.id, newId, 'accepted', 'Good revision.');
  expect((await loadMilestoneWorkspace(student)).projects[0].milestones[0].status).toBe('accepted');
  await expect(saveContribution(student, original.id, newId, 'Changed statement')).rejects.toThrow(
    /locked/,
  );
  await expect(reviewMilestone(supervisor, original.id, newId, 'accepted', '')).rejects.toThrow(
    /already reviewed/,
  );
});
it('allows a teammate to record only their own statement for the current attempt', async () => {
  const entry = latestSubmission(
    (await loadMilestoneWorkspace(student)).projects[0].milestones[0],
  )!;
  const teammate = { ...student, id: 'student-farhan', full_name: 'Farhan Ahmed' };
  await saveContribution(
    teammate,
    'milestone-plan',
    entry.id,
    'Implemented the data model and constraints.',
  );
  const saved = latestSubmission(
    (await loadMilestoneWorkspace(student)).projects[0].milestones[0],
  )!;
  expect(saved.contributions.find((c) => c.student_id === teammate.id)?.statement).toContain(
    'constraints',
  );
  expect(saved.contributions.find((c) => c.student_id === student.id)).toEqual(
    entry.contributions.find((c) => c.student_id === student.id),
  );
});
it('denies other roles, unassigned projects, malformed records, and forged contributions', async () => {
  await expect(loadMilestoneWorkspace({ ...student, role: 'examiner' })).rejects.toThrow(
    /Only students/,
  );
  await expect(
    reviewMilestone(student, 'milestone-plan', 'submission-plan', 'accepted', ''),
  ).rejects.toThrow(/Only assigned/);
  await expect(
    submitMilestone(
      { ...student, id: 'outsider' },
      'milestone-design',
      document(),
      'Evidence',
      null,
    ),
  ).rejects.toThrow(/not available/);
  const workspace = await loadMilestoneWorkspace(student);
  expect(() => validateMilestoneWorkspace({ ...workspace, actor_id: 'other' }, student)).toThrow(
    /invalid/,
  );
  latestSubmission(workspace.projects[0].milestones[0])!.contributions[0].student_id = 'outsider';
  expect(() => validateMilestoneWorkspace(workspace, student)).toThrow(/invalid/);
});
it('shows supervisor rework feedback on the student dashboard', async () => {
  await reviewMilestone(
    supervisor,
    'milestone-plan',
    'submission-plan',
    'needs_rework',
    'Document the validation strategy.',
  );
  sessionStorage.setItem('fyp-compass.demo-role', 'student');
  render(
    <MemoryRouter initialEntries={['/student/dashboard']}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('Document the validation strategy.', {}, { timeout: 5000 }),
  ).toBeInTheDocument();
});
it('submits a student file and displays individual evidence and missing statements', async () => {
  sessionStorage.setItem('fyp-compass.demo-role', 'student');
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/student/milestones/milestone-design']}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  const statement = await screen.findByLabelText('Your contribution statement (required)');
  await user.click(statement);
  await user.paste('Built the navigation prototype and captured user feedback.');
  await user.upload(screen.getByLabelText(/Choose a document/), document());
  await user.click(screen.getByRole('button', { name: 'Submit milestone' }));
  expect(await screen.findByText('prototype.pdf')).toBeInTheDocument();
  expect(screen.getByText('1 / 3 recorded')).toBeInTheDocument();
  expect(screen.getByText(/Missing this attempt: Farhan Ahmed, Zain Abbas/)).toBeInTheDocument();
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';
import {
  createGroup,
  initialWorkspace,
  loadWorkspace,
  saveProposal,
  validateGroup,
  validateProposal,
} from '../lib/student-api';
import type { PortalUser } from '../types/shared';
import type { ProposalInput } from '../types/student';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
const student: PortalUser = {
  id: 'demo-student',
  full_name: 'Ayesha Khan',
  email: 'student@demo.fypcompass.local',
  role: 'student',
};
const complete: ProposalInput = {
  title: 'FYP Portal',
  abstract: 'A shared supervision workspace.',
  keywords: ['supervision'],
  topic_ids: ['web'],
  supervisor_ids: ['supervisor-ahmed', 'supervisor-sara', 'supervisor-hassan'],
};
it('enforces group size, unique members and availability', () => {
  const workspace = initialWorkspace();
  expect(() => validateGroup(workspace, [], 'Solo project')).not.toThrow();
  expect(() =>
    validateGroup(workspace, ['student-farhan', 'student-zain', 'student-ali'], 'Too large'),
  ).toThrow(/one to three/);
  expect(() => validateGroup(workspace, ['student-zain', 'student-zain'], 'Duplicates')).toThrow(
    /different/,
  );
  expect(() => validateGroup(workspace, ['unknown-student'], 'Unknown')).toThrow(/available/);
});
it('persists a three-member group and prevents a second active group', async () => {
  await createGroup(student, 'Team Compass', ['student-farhan', 'student-zain']);
  const workspace = await loadWorkspace(student);
  expect(workspace.group?.members.map((member) => member.id)).toEqual([
    'demo-student',
    'student-farhan',
    'student-zain',
  ]);
  await expect(createGroup(student, 'Second group', [])).rejects.toThrow(/already belong/);
  expect((await loadWorkspace({ ...student, id: 'other-student' })).group).toBeNull();
});
it('enforces three distinct ranked supervisors and controlled topic limits', async () => {
  const workspace = await createGroup(student, 'Solo', []);
  expect(() =>
    validateProposal(
      workspace,
      { ...complete, supervisor_ids: ['supervisor-ahmed', '', ''] },
      true,
    ),
  ).toThrow(/three different/);
  expect(() =>
    validateProposal(
      workspace,
      { ...complete, supervisor_ids: ['supervisor-ahmed', 'supervisor-ahmed', 'supervisor-sara'] },
      true,
    ),
  ).toThrow(/different/);
  expect(() =>
    validateProposal(workspace, { ...complete, topic_ids: ['web', 'data', 'ai', 'iot'] }, true),
  ).toThrow(/up to three/);
  expect(() => validateProposal(workspace, { ...complete, topic_ids: ['custom'] }, true)).toThrow(
    /controlled/,
  );
});
it('updates one draft, submits it, and blocks another active proposal', async () => {
  await createGroup(student, 'Team', []);
  const draft = await saveProposal(
    student,
    { ...complete, abstract: '', supervisor_ids: ['', '', ''] },
    null,
    false,
  );
  expect(draft.proposal?.status).toBe('draft');
  const submitted = await saveProposal(
    student,
    complete,
    new File(['demo'], 'proposal.pdf', { type: 'application/pdf' }),
    true,
  );
  expect(submitted.proposal?.id).toBe(draft.proposal?.id);
  expect(submitted.proposal?.status).toBe('submitted');
  expect(submitted.proposal?.document).toMatchObject({ name: 'proposal.pdf', path: null });
  expect(submitted.allocation).toBeNull();
  await expect(saveProposal(student, complete, null, true)).rejects.toThrow(/already submitted/);
});
it('rejects unsafe documents and non-student workspace access', async () => {
  await createGroup(student, 'Team', []);
  await expect(
    saveProposal(student, complete, new File(['bad'], 'payload.exe'), true),
  ).rejects.toThrow(/PDF/);
  await expect(loadWorkspace({ ...student, role: 'supervisor' })).rejects.toThrow(/Only students/);
});
it('lets a student create a team, save a draft, reload, and submit it', async () => {
  sessionStorage.setItem('fyp-compass.demo-role', 'student');
  const user = userEvent.setup();
  function portal(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <PortalRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
  }
  const first = portal('/student/group');
  await user.click(await screen.findByLabelText('Group name'));
  await user.paste('Team Compass');
  await user.click(screen.getByRole('checkbox', { name: /Farhan Ahmed/ }));
  await user.click(screen.getByRole('checkbox', { name: /Zain Abbas/ }));
  expect(screen.getByRole('checkbox', { name: /Ali Raza/ })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Create group' }));
  await user.click(await screen.findByRole('link', { name: 'Prepare your proposal' }));
  await user.click(await screen.findByLabelText('Project title'));
  await user.paste('FYP Portal');
  await user.click(screen.getByLabelText('Abstract'));
  await user.paste('A shared supervision workspace.');
  await user.click(screen.getByLabelText('Keywords'));
  await user.paste('portal, supervision');
  await user.click(screen.getByRole('checkbox', { name: 'Web Development' }));
  await user.selectOptions(screen.getByLabelText(/First choice/), 'supervisor-ahmed');
  await user.selectOptions(screen.getByLabelText(/Second choice/), 'supervisor-sara');
  await user.selectOptions(screen.getByLabelText(/Third choice/), 'supervisor-hassan');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();
  first.unmount();
  portal('/student/proposal');
  expect(await screen.findByLabelText('Project title')).toHaveValue('FYP Portal');
  await user.click(screen.getByRole('button', { name: 'Submit proposal' }));
  expect(await screen.findByRole('heading', { name: 'FYP Portal' })).toBeInTheDocument();
  expect(screen.getByText('Your proposal has been submitted and saved.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Awaiting supervisor matching' })).toBeInTheDocument();
}, 15000);

it('shows recorded feedback and accurate status for an approved student proposal', async () => {
  await createGroup(student, 'Team', []);
  const workspace = await saveProposal(student, complete, null, true);
  workspace.proposal!.status = 'approved';
  workspace.proposal!.feedback = 'Approved after narrowing the project scope.';
  localStorage.setItem('fyp-compass.student.v1.' + student.id, JSON.stringify(workspace));
  sessionStorage.setItem('fyp-compass.demo-role', 'student');
  render(
    <MemoryRouter initialEntries={['/student/proposal']}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Your proposal has been approved.')).toBeInTheDocument();
  expect(screen.getByText('Approved after narrowing the project scope.')).toBeInTheDocument();
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';
import {
  initialSupervisorWorkspace,
  loadSupervisorWorkspace,
  reviewProposal,
  validateReview,
  validateSupervisorWorkspace,
} from '../lib/supervisor-api';
import type { PortalUser } from '../types/shared';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
const supervisor: PortalUser = {
  id: 'demo-supervisor',
  full_name: 'Dr. Ahmed Ali',
  email: 'supervisor@demo.fypcompass.local',
  role: 'supervisor',
};
it('requires comments for rejection and change requests', () => {
  const workspace = initialSupervisorWorkspace(supervisor);
  for (const action of ['reject', 'changes_requested'] as const)
    expect(() =>
      validateReview(workspace, 'proposal-compass', { action, comment: '  ', justification: '' }),
    ).toThrow(/Comments are required/);
});
it('allows a flagged approval only with a justification, without automatically rejecting it', async () => {
  const workspace = await loadSupervisorWorkspace(supervisor);
  expect(workspace.proposals.find((item) => item.id === 'proposal-nexus')?.status).toBe(
    'submitted',
  );
  await expect(
    reviewProposal(supervisor, 'proposal-nexus', {
      action: 'approve',
      comment: '',
      justification: ' ',
    }),
  ).rejects.toThrow(/justification is required/);
  const result = await reviewProposal(supervisor, 'proposal-nexus', {
    action: 'approve',
    comment: '',
    justification: 'The shared terminology is standard; the implementation and evaluation differ.',
  });
  expect(result.proposals.find((item) => item.id === 'proposal-nexus')?.status).toBe('approved');
  expect(
    result.proposals.find((item) => item.id === 'proposal-nexus')?.review?.justification,
  ).toContain('implementation');
});
it('persists an approval and its project/milestones, then rejects duplicate review actions', async () => {
  const result = await reviewProposal(supervisor, 'proposal-compass', {
    action: 'approve',
    comment: 'Suitable scope.',
    justification: '',
  });
  const project = result.proposals.find((item) => item.id === 'proposal-compass')?.project;
  expect(project?.milestones).toHaveLength(3);
  expect(project?.milestones.every((item) => item.status === 'not_started')).toBe(true);
  expect(
    (await loadSupervisorWorkspace(supervisor)).proposals.find(
      (item) => item.id === 'proposal-compass',
    )?.project,
  ).toEqual(project);
  await expect(
    reviewProposal(supervisor, 'proposal-compass', {
      action: 'approve',
      comment: '',
      justification: '',
    }),
  ).rejects.toThrow(/Only submitted/);
  expect(
    (await loadSupervisorWorkspace(supervisor)).proposals.find(
      (item) => item.id === 'proposal-compass',
    )?.project,
  ).toEqual(project);
});
it.each(['changes_requested', 'reject'] as const)(
  'records %s feedback without creating a project',
  async (action) => {
    const result = await reviewProposal(supervisor, 'proposal-compass', {
      action,
      comment: 'Clarify the evaluation plan.',
      justification: '',
    });
    const proposal = result.proposals.find((item) => item.id === 'proposal-compass');
    expect(proposal?.status).toBe(action === 'reject' ? 'rejected' : 'changes_requested');
    expect(proposal?.review?.comment).toBe('Clarify the evaluation plan.');
    expect(proposal?.project).toBeNull();
  },
);
it('denies unallocated proposals and other roles', async () => {
  await expect(
    reviewProposal(supervisor, 'unknown-proposal', {
      action: 'approve',
      comment: '',
      justification: '',
    }),
  ).rejects.toThrow(/not in your allocated/);
  await expect(loadSupervisorWorkspace({ ...supervisor, role: 'student' })).rejects.toThrow(
    /Only supervisors/,
  );
});
it('rejects another supervisor’s workspace and invalid similarity percentages', () => {
  const workspace = initialSupervisorWorkspace(supervisor);
  expect(() =>
    validateSupervisorWorkspace({ ...workspace, supervisor_id: 'other-supervisor' }, supervisor),
  ).toThrow(/Unable to read/);
  workspace.proposals[0].similarity.percentage = 101;
  expect(() => validateSupervisorWorkspace(workspace, supervisor)).toThrow(/Unable to read/);
});
it('shows a flagged proposal, saves justified approval, and restores its project after reload', async () => {
  sessionStorage.setItem('fyp-compass.demo-role', 'supervisor');
  const user = userEvent.setup();
  function portal() {
    return render(
      <MemoryRouter initialEntries={['/supervisor/proposals/proposal-nexus']}>
        <AuthProvider>
          <PortalRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
  }
  const first = portal();
  expect(
    await screen.findByRole('heading', { name: 'Requires closer review' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Approval justification (required)')).toBeRequired();
  await user.click(screen.getByLabelText('Approval justification (required)'));
  await user.paste(
    'Standard terms overlap, but the proposed implementation is independently scoped.',
  );
  await user.click(screen.getByRole('button', { name: 'Approve proposal' }));
  expect(await screen.findByRole('heading', { name: 'Proposal approved.' })).toBeInTheDocument();
  expect(screen.getByText('Project active')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Project milestone plan' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve proposal' })).not.toBeInTheDocument();
  first.unmount();
  portal();
  expect(await screen.findByRole('heading', { name: 'Proposal approved.' })).toBeInTheDocument();
  expect(screen.getByText(/Standard terms overlap/)).toBeInTheDocument();
}, 15000);

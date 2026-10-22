import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PortalRoutes } from '../App';
import {
  DEMO_SIMILARITY_PROPOSALS,
  loadDemoSimilarityCorpus,
  screenProposal,
} from '../lib/similarity';
import {
  loadSupervisorWorkspace,
  rescreenProposal,
  reviewProposal,
  validateReview,
} from '../lib/supervisor-api';
import type { PortalUser } from '../types/shared';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
const actor: PortalUser = {
  id: 'demo-supervisor',
  role: 'supervisor',
  full_name: 'Supervisor',
  email: 'supervisor@demo.local',
};
const candidate = DEMO_SIMILARITY_PROPOSALS[0];
const target = { ...candidate, id: 'new-proposal' };
it('computes an identical proposal at 100%, stores the closest ID, and flags it without a decision', () => {
  const result = screenProposal(target, DEMO_SIMILARITY_PROPOSALS);
  expect(result.percentage).toBe(100);
  expect(result.closest_proposal_id).toBe(candidate.id);
  expect(result.status).toBe('flagged');
  expect(result.disclaimer).toContain('not a plagiarism verdict');
  expect(result).not.toHaveProperty('proposal_status');
});
it('normalizes case, punctuation and Unicode without matching the proposal to itself', () => {
  expect(
    screenProposal({ id: 'new', title: 'ＦＹＰ Portal!', abstract: 'Milestones.' }, [
      { id: 'old', title: 'fyp portal', abstract: 'milestones' },
    ]).percentage,
  ).toBe(100);
  expect(screenProposal(candidate, [candidate]).closest_proposal_id).toBeNull();
});
it('returns a clear zero score for an empty corpus and finds a low score for unrelated work', () => {
  expect(screenProposal(target, []).percentage).toBe(0);
  expect(screenProposal(target, [DEMO_SIMILARITY_PROPOSALS[1]]).status).toBe('clear');
});
it('uses the selected threshold and deterministic ID order for ties', () => {
  const a = { ...candidate, id: 'a' };
  const z = { ...candidate, id: 'z' };
  expect(screenProposal(target, [z, a], 100).closest_proposal_id).toBe('a');
  expect(screenProposal(target, [a, z], 100).status).toBe('flagged');
});
it('rejects invalid thresholds, duplicate IDs, unreadable corpora and excessive text', () => {
  expect(() => screenProposal(target, [], NaN)).toThrow(/threshold/);
  expect(() => screenProposal(target, [], 0)).toThrow(/threshold/);
  expect(() => screenProposal(target, [candidate, candidate])).toThrow(/unique/);
  expect(() => screenProposal({ ...target, abstract: 'x'.repeat(50001) }, [])).toThrow(/50,000/);
  localStorage.setItem('fyp-compass.similarity.corpus.v1', 'invalid');
  expect(() => loadDemoSimilarityCorpus()).toThrow(/could not be read/);
});
it('calculates the prepared similar proposal and persists screening metadata across reload', async () => {
  const before = await loadSupervisorWorkspace(actor);
  const result = await rescreenProposal(actor, 'proposal-nexus');
  const proposal = result.proposals.find((item) => item.id === 'proposal-nexus')!;
  expect(proposal.similarity.percentage).toBeGreaterThanOrEqual(60);
  expect(proposal.similarity.closest_proposal_id).toBe('archive-campus');
  expect(proposal.status).toBe('submitted');
  expect(proposal.review).toBeNull();
  expect(result.proposals.find((item) => item.id === 'proposal-compass')?.similarity.status).toBe(
    'clear',
  );
  expect(
    (await loadSupervisorWorkspace(actor)).proposals.find((item) => item.id === proposal.id)
      ?.similarity,
  ).toEqual(proposal.similarity);
  expect(before.proposals.length).toBe(result.proposals.length);
});
it('requires justification for computed flags and blocks approval while screening is pending', async () => {
  const workspace = await rescreenProposal(actor, 'proposal-nexus');
  expect(() =>
    validateReview(workspace, 'proposal-nexus', {
      action: 'approve',
      comment: '',
      justification: '',
    }),
  ).toThrow(/justification/);
  workspace.proposals[0].similarity = { percentage: null, closest_title: null, status: 'pending' };
  expect(() =>
    validateReview(workspace, workspace.proposals[0].id, {
      action: 'approve',
      comment: '',
      justification: '',
    }),
  ).toThrow(/screening/i);
});
it('denies other roles, unallocated proposals and changes to already decided proposals', async () => {
  await expect(rescreenProposal({ ...actor, role: 'student' }, 'proposal-nexus')).rejects.toThrow(
    /Only supervisors/,
  );
  await expect(rescreenProposal(actor, 'unknown')).rejects.toThrow(/allocated/);
  await reviewProposal(actor, 'proposal-compass', {
    action: 'approve',
    comment: '',
    justification: '',
  });
  await expect(rescreenProposal(actor, 'proposal-compass')).rejects.toThrow(/submitted/);
});
it('shows computed screening, supports re-screening and retains the justified approval workflow', async () => {
  sessionStorage.setItem('fyp-compass.demo-role', 'supervisor');
  render(
    <MemoryRouter initialEntries={['/supervisor/proposals/proposal-nexus']}>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  const rerun = await screen.findByRole(
    'button',
    { name: 'Run similarity screening again' },
    { timeout: 10000 },
  );
  await userEvent.click(rerun);
  expect(
    await screen.findByRole('heading', { name: 'Requires closer review' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/archive|Campus Project Tracking System/)).toBeInTheDocument();
  expect(screen.getByLabelText('Approval justification (required)')).toBeRequired();
});

import { rpcName } from './backend-version';
import {
  screenProposal,
  DEMO_SIMILARITY_PROPOSALS,
  loadDemoSimilarityCorpus,
  type SimilarityProposal,
} from './similarity';
import { demoEnabled, supabase } from './supabase';
import type { PortalUser } from '../types/shared';
import type { ReviewInput, SupervisedProposal, SupervisorWorkspace } from '../types/supervisor';

const storageKey = (user: PortalUser) => `fyp-compass.supervisor.v1.${user.id}`;
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString();
function projectFor(proposal: SupervisedProposal) {
  return {
    id: proposal.group_id,
    title: proposal.title,
    started_at: new Date().toISOString(),
    milestones: [
      {
        id: crypto.randomUUID(),
        name: 'Requirements and project plan',
        deadline: day(7),
        status: 'not_started' as const,
      },
      {
        id: crypto.randomUUID(),
        name: 'Design and prototype',
        deadline: day(14),
        status: 'not_started' as const,
      },
      {
        id: crypto.randomUUID(),
        name: 'Implementation and progress report',
        deadline: day(28),
        status: 'not_started' as const,
      },
    ],
  };
}
export function initialSupervisorWorkspace(
  user: PortalUser,
  corpus: SimilarityProposal[] = DEMO_SIMILARITY_PROPOSALS,
): SupervisorWorkspace {
  const abstractFor = (id: string, title: string) =>
    id === 'proposal-compass'
      ? 'Students form supervised research groups, submit proposals, upload milestone evidence and explain their individual contributions. Access controlled academic review keeps approvals and feedback attached to the correct student team.'
      : id === 'proposal-atlas'
        ? 'Campus laboratories manage equipment bookings, resource budgets and room occupancy. A scheduling planner reduces clashes between teaching timetables and laboratory availability using demand forecasts.'
        : 'The ' +
          title +
          ' project addresses a practical problem through a focused software solution. The team will investigate user needs, design a working prototype, and evaluate the result against clear project objectives.';
  const proposal = (
    id: string,
    group: string,
    title: string,
    names: string[],
    _percentage: number,
    _flagged: boolean,
  ): SupervisedProposal => ({
    id,
    group_id: `group-${id}`,
    group_name: group,
    members: names.map((name, index) => ({ id: `${id}-member-${index}`, full_name: name })),
    title,
    abstract: abstractFor(id, title),
    keywords: ['software', 'project', 'prototype'],
    topics: ['Web Development'],
    status: 'submitted',
    submitted_at: day(-1),
    document: null,
    similarity: screenProposal({ id, title, abstract: abstractFor(id, title) }, corpus),
    review: null,
    project: null,
  });
  const completed = proposal(
    'proposal-atlas',
    'Team Atlas',
    'Smart Campus Resource Planner',
    ['Hamza Noor', 'Bilal Ahmed'],
    18,
    false,
  );
  completed.status = 'approved';
  completed.project = projectFor(completed);
  completed.review = {
    action: 'approve',
    comment: 'Scope and evaluation plan are suitable.',
    justification: '',
    reviewer_id: user.id,
    reviewed_at: day(-1),
  };
  return {
    supervisor_id: user.id,
    session_name: 'Final Year Projects · Demo Session',
    capacity: 4,
    proposals: [
      proposal(
        'proposal-compass',
        'Team Compass',
        'FYP Supervision Portal',
        ['Ayesha Khan', 'Farhan Ahmed', 'Zain Abbas'],
        12,
        false,
      ),
      proposal(
        'proposal-nexus',
        'Team Nexus',
        'Campus Project Tracking Platform',
        ['Ali Raza', 'Hina Aslam'],
        78,
        true,
      ),
      completed,
    ],
  };
}
function requireSupervisor(user: PortalUser) {
  if (user.role !== 'supervisor')
    throw new Error('Only supervisors can review allocated proposals.');
}
export function validateSupervisorWorkspace(data: unknown, user: PortalUser): SupervisorWorkspace {
  const workspace = data as SupervisorWorkspace | null;
  const invalid = () => {
    throw new Error(
      'Unable to read your supervision records. Ask the coordinator to check the workspace configuration.',
    );
  };
  const strings = (items: unknown) =>
    Array.isArray(items) && items.every((item) => typeof item === 'string');
  if (
    !workspace ||
    typeof workspace !== 'object' ||
    workspace.supervisor_id !== user.id ||
    typeof workspace.session_name !== 'string' ||
    !Number.isInteger(workspace.capacity) ||
    workspace.capacity < 0 ||
    !Array.isArray(workspace.proposals)
  )
    return invalid();
  for (const proposal of workspace.proposals) {
    if (
      !proposal ||
      typeof proposal.id !== 'string' ||
      typeof proposal.group_id !== 'string' ||
      typeof proposal.group_name !== 'string' ||
      typeof proposal.title !== 'string' ||
      typeof proposal.abstract !== 'string' ||
      typeof proposal.submitted_at !== 'string' ||
      !strings(proposal.keywords) ||
      !strings(proposal.topics) ||
      !['draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn'].includes(
        proposal.status,
      ) ||
      !Array.isArray(proposal.members) ||
      !proposal.members.every(
        (member) => member && typeof member.id === 'string' && typeof member.full_name === 'string',
      )
    )
      return invalid();
    const result = proposal.similarity;
    if (
      !result ||
      !['pending', 'clear', 'flagged'].includes(result.status) ||
      (result.percentage !== null &&
        (!Number.isFinite(result.percentage) ||
          result.percentage < 0 ||
          result.percentage > 100)) ||
      (result.closest_title !== null && typeof result.closest_title !== 'string')
    )
      return invalid();
    if (
      (result.closest_proposal_id !== undefined &&
        result.closest_proposal_id !== null &&
        typeof result.closest_proposal_id !== 'string') ||
      (result.threshold !== undefined &&
        (!Number.isFinite(result.threshold) || result.threshold <= 0 || result.threshold > 100)) ||
      (result.screened_at !== undefined &&
        (typeof result.screened_at !== 'string' ||
          !Number.isFinite(Date.parse(result.screened_at)))) ||
      (result.method !== undefined && typeof result.method !== 'string') ||
      (result.disclaimer !== undefined && typeof result.disclaimer !== 'string')
    )
      return invalid();
    if (
      proposal.document !== null &&
      (!proposal.document ||
        typeof proposal.document.name !== 'string' ||
        typeof proposal.document.size !== 'number' ||
        (proposal.document.path !== null && typeof proposal.document.path !== 'string'))
    )
      return invalid();
    if (
      proposal.review !== null &&
      (!proposal.review ||
        !['approve', 'changes_requested', 'reject'].includes(proposal.review.action) ||
        typeof proposal.review.comment !== 'string' ||
        typeof proposal.review.justification !== 'string' ||
        typeof proposal.review.reviewer_id !== 'string' ||
        typeof proposal.review.reviewed_at !== 'string')
    )
      return invalid();
    if (
      proposal.project !== null &&
      (!proposal.project ||
        typeof proposal.project.id !== 'string' ||
        typeof proposal.project.title !== 'string' ||
        typeof proposal.project.started_at !== 'string' ||
        !Array.isArray(proposal.project.milestones) ||
        !proposal.project.milestones.every(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            typeof item.deadline === 'string' &&
            ['not_started', 'submitted', 'needs_rework', 'accepted'].includes(item.status),
        ))
    )
      return invalid();
  }
  if (
    new Set(workspace.proposals.map((item) => item.id)).size !== workspace.proposals.length ||
    new Set(workspace.proposals.map((item) => item.group_id)).size !== workspace.proposals.length
  )
    return invalid();
  return workspace;
}
async function rpc(user: PortalUser, name: string, args?: Record<string, unknown>) {
  if (!supabase) throw new Error('The connected workspace is not configured.');
  const { data, error } = await supabase.rpc(rpcName(name), args);
  if (error) throw new Error(`Your supervision workspace could not be updated: ${error.message}`);
  return validateSupervisorWorkspace(data, user);
}
export async function loadSupervisorWorkspace(user: PortalUser) {
  requireSupervisor(user);
  if (!demoEnabled) return rpc(user, 'get_supervisor_workspace');
  let stored: string | null;
  try {
    stored = localStorage.getItem(storageKey(user));
  } catch {
    throw new Error('Local demo storage is unavailable. Enable browser storage and retry.');
  }
  if (!stored) {
    const initial = initialSupervisorWorkspace(user, loadDemoSimilarityCorpus());
    try {
      localStorage.setItem(storageKey(user), JSON.stringify(initial));
    } catch {
      throw new Error(
        'Your browser could not initialize the supervision demo. Enable local storage and retry.',
      );
    }
    return initial;
  }
  try {
    return validateSupervisorWorkspace(JSON.parse(stored), user);
  } catch {
    throw new Error(
      'Saved supervision demo data is invalid. Clear this site’s local demo storage to start again.',
    );
  }
}
export function validateReview(
  workspace: SupervisorWorkspace,
  proposalId: string,
  input: ReviewInput,
) {
  const proposal = workspace.proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error('This proposal is not in your allocated groups.');
  if (proposal.status !== 'submitted')
    throw new Error(
      'Only submitted proposals can receive a new review. Refresh the page for the latest status.',
    );
  if (input.action === 'approve' && proposal.similarity.status === 'pending')
    throw new Error('Complete similarity screening before approving this proposal.');
  if (!['approve', 'changes_requested', 'reject'].includes(input.action))
    throw new Error('Choose a valid review action.');
  if (input.action !== 'approve' && !input.comment.trim())
    throw new Error('Comments are required when requesting changes or rejecting a proposal.');
  if (
    input.action === 'approve' &&
    proposal.similarity.status === 'flagged' &&
    !input.justification.trim()
  )
    throw new Error('A justification is required to approve this flagged proposal.');
  return proposal;
}
export async function reviewProposal(user: PortalUser, proposalId: string, input: ReviewInput) {
  const workspace = await loadSupervisorWorkspace(user);
  const proposal = validateReview(workspace, proposalId, input);
  if (!demoEnabled)
    return rpc(user, 'review_supervisor_proposal', {
      p_proposal_id: proposalId,
      p_action: input.action,
      p_comment: input.comment.trim(),
      p_justification: input.justification.trim(),
      p_expected_status: 'submitted',
    });
  const updated: SupervisedProposal = {
    ...proposal,
    status:
      input.action === 'approve'
        ? 'approved'
        : input.action === 'reject'
          ? 'rejected'
          : 'changes_requested',
    review: {
      ...input,
      comment: input.comment.trim(),
      justification: input.justification.trim(),
      reviewer_id: user.id,
      reviewed_at: new Date().toISOString(),
    },
    project:
      input.action === 'approve' ? proposal.project || projectFor(proposal) : proposal.project,
  };
  const result = {
    ...workspace,
    proposals: workspace.proposals.map((item) => (item.id === proposalId ? updated : item)),
  };
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(result));
  } catch {
    throw new Error('Your browser could not save this review. Enable local storage and retry.');
  }
  return result;
}

export async function rescreenProposal(
  user: PortalUser,
  proposalId: string,
): Promise<SupervisorWorkspace> {
  requireSupervisor(user);
  const workspace = await loadSupervisorWorkspace(user);
  const proposal = workspace.proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error('This proposal is not in your allocated groups.');
  if (proposal.status !== 'submitted')
    throw new Error('Only submitted proposals can be screened again.');
  if (!demoEnabled) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.rpc(rpcName('fyp_run_similarity_screen'), {
      p_proposal_id: proposalId,
    });
    if (error) throw new Error('Similarity screening could not run: ' + error.message);
    const refreshed = await loadSupervisorWorkspace(user);
    if (
      !refreshed.proposals.some(
        (item) =>
          item.id === proposalId &&
          item.similarity.status !== 'pending' &&
          item.similarity.percentage !== null,
      )
    )
      throw new Error(
        'The backend did not return a completed screening result. Refresh or ask the coordinator to check screening.',
      );
    return refreshed;
  }
  const result = {
    ...workspace,
    proposals: workspace.proposals.map((item) =>
      item.id === proposalId
        ? {
            ...item,
            similarity: screenProposal(
              { id: item.id, title: item.title, abstract: item.abstract },
              loadDemoSimilarityCorpus(),
            ),
          }
        : item,
    ),
  };
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(result));
  } catch {
    throw new Error('The screening result could not be saved. Enable browser storage and retry.');
  }
  return validateSupervisorWorkspace(result, user);
}

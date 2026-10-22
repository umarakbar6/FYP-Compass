import type { MilestoneStatus, PortalUser, ProposalStatus } from './shared';
import type { ProposalDocument } from './student';
export interface SimilarityScreen {
  closest_proposal_id?: string | null;
  threshold?: number;
  screened_at?: string;
  method?: string;
  disclaimer?: string;
  percentage: number | null;
  closest_title: string | null;
  status: 'pending' | 'clear' | 'flagged';
}
export interface ProjectSummary {
  id: string;
  title: string;
  started_at: string;
  milestones: { id: string; name: string; deadline: string; status: MilestoneStatus }[];
}
export interface ProposalReview {
  action: 'approve' | 'changes_requested' | 'reject';
  comment: string;
  justification: string;
  reviewer_id: string;
  reviewed_at: string;
}
export interface SupervisedProposal {
  id: string;
  group_id: string;
  group_name: string;
  members: { id: string; full_name: string }[];
  title: string;
  abstract: string;
  keywords: string[];
  topics: string[];
  status: ProposalStatus;
  submitted_at: string;
  document: ProposalDocument | null;
  similarity: SimilarityScreen;
  review: ProposalReview | null;
  project: ProjectSummary | null;
}
export interface SupervisorWorkspace {
  supervisor_id: string;
  session_name: string;
  capacity: number;
  proposals: SupervisedProposal[];
}
export interface ReviewInput {
  action: ProposalReview['action'];
  comment: string;
  justification: string;
}
export type SupervisorAccount = PortalUser;

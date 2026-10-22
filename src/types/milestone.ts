import type { MilestoneStatus } from './shared';
import type { ProposalDocument } from './student';
export interface Contribution {
  student_id: string;
  statement: string;
  updated_at: string;
}
export interface MilestoneReview {
  action: 'accepted' | 'needs_rework';
  feedback: string;
  reviewer_id: string;
  reviewed_at: string;
}
export interface MilestoneSubmission {
  id: string;
  submitted_by: string;
  submitted_at: string;
  document: ProposalDocument;
  contributions: Contribution[];
  review: MilestoneReview | null;
}
export interface Milestone {
  id: string;
  name: string;
  description: string;
  deadline: string;
  status: MilestoneStatus;
  submissions: MilestoneSubmission[];
}
export interface MilestoneProject {
  id: string;
  group_name: string;
  title: string;
  supervisor_id: string;
  members: { id: string; full_name: string }[];
  milestones: Milestone[];
}
export interface MilestoneWorkspace {
  actor_id: string;
  projects: MilestoneProject[];
}

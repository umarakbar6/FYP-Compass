import { coreV2 } from '../lib/backend-version';
import { useHealth } from '../health/HealthProvider';
import { HealthDashboardSummary } from '../health/NoticesPage';
import { Link } from 'react-router-dom';
import { Users, FileText, Flag, HeartPulse, ArrowRight } from 'lucide-react';
import { useStudent } from './StudentProvider';
import { WorkspaceGate, DataMode, ProposalBadge } from './common';
import { EmptyState, StatisticCard, StatusBadge } from '../components/ui';
import { AllocationView } from './ProposalPage';
import { useMilestones } from '../milestones/MilestoneProvider';

import { MilestoneDashboardSummary } from '../milestones/common';
export function StudentDashboard() {
  const milestones = useMilestones();
  const { workspace, loading, error } = useStudent();
  const { workspace: healthWorkspace } = useHealth();
  const health = healthWorkspace?.projects.find((project) =>
    coreV2 ? project.id === workspace?.group?.id : !project.prepared,
  )?.health;
  if (loading || error || !workspace) return <WorkspaceGate />;
  const { group, proposal } = workspace;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">STUDENT OVERVIEW</span>
          <h1>Your next big idea starts here.</h1>
          <p>Your team, your proposal, and the next step forward.</p>
        </div>
        <StatusBadge>Student workflow</StatusBadge>
      </div>
      <DataMode />
      <section className="welcome-banner">
        <div>
          <span className="welcome-kicker">YOUR NEXT STEP</span>
          <h2>
            {!group
              ? 'Build the team.\nStart the journey.'
              : !proposal
                ? 'Your team is ready.\nGive your idea a direction.'
                : proposal.status === 'draft'
                  ? 'A strong idea\nstarts with a clear proposal.'
                  : 'Your proposal is in.\nKeep your next step in sight.'}
          </h2>
          <p>{group ? group.name : 'Work individually or bring up to two teammates.'}</p>
          <Link className="button button-light" to={group ? '/student/proposal' : '/student/group'}>
            {!group
              ? 'Create your group'
              : !proposal
                ? 'Prepare your proposal'
                : 'View your proposal'}
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="banner-ring" />
          <div className="banner-ring inner" />
          <div className="banner-symbol">
            <Users size={49} strokeWidth={1.2} />
          </div>
        </div>
      </section>
      <div className="stats-grid">
        <StatisticCard
          label="Group members"
          value={group ? `${group.members.length} / 3` : '0 / 3'}
          detail={group?.name || 'Create your team'}
          icon={Users}
        />
        <StatisticCard
          label="Proposal"
          value={proposal ? (proposal.status === 'draft' ? 'Draft' : 'Saved') : '—'}
          detail={proposal ? proposal.status.replaceAll('_', ' ') : 'No proposal yet'}
          icon={FileText}
        />
        <StatisticCard
          label="Milestones"
          value={
            milestones.workspace
              ? String(
                  milestones.workspace.projects
                    .flatMap((p) => p.milestones)
                    .filter((m) => m.status === 'accepted').length,
                )
              : '—'
          }
          detail="Accepted in milestone workspace"
          icon={Flag}
        />
        <StatisticCard
          label="Group health"
          value={health ? health.level.toUpperCase() : group ? 'Checking' : '—'}
          detail={
            health
              ? 'Deterministic health rules'
              : group
                ? 'Live health rules'
                : 'Create a group first'
          }
          icon={HeartPulse}
        />
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>Project overview</h2>
            {proposal && <ProposalBadge status={proposal.status} />}
          </div>
          {proposal ? (
            <div className="proposal-summary">
              <h3>{proposal.title || 'Untitled draft'}</h3>
              <p>{proposal.abstract || 'Your abstract has not been added yet.'}</p>
              <Link className="text-link" to="/student/proposal">
                Open proposal
                <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <EmptyState
              title={
                group
                  ? 'Your group is ready for a proposal'
                  : 'Your project journey is ready to begin'
              }
              description={
                group
                  ? 'Define your project and choose three different supervisors.'
                  : 'Create a team of one to three students to get started.'
              }
              action={
                <Link className="text-link" to={group ? '/student/proposal' : '/student/group'}>
                  Continue
                  <ArrowRight size={16} />
                </Link>
              }
            />
          )}
        </section>
        <section className="panel phase-form">
          <AllocationView workspace={workspace} />
          <div className="guide-accent">
            Open Milestones to submit evidence and check supervisor feedback.
          </div>
        </section>
      </div>
      <MilestoneDashboardSummary />
      <HealthDashboardSummary />
    </>
  );
}

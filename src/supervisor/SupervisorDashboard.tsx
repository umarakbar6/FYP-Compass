import { HealthDashboardSummary } from '../health/NoticesPage';
import { Link } from 'react-router-dom';
import { FileText, Users, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import { useSupervisor } from './SupervisorProvider';
import { SupervisorGate, SupervisorDataMode } from './common';
import { Button, EmptyState, StatisticCard, StatusBadge } from '../components/ui';
import { ProposalBadge } from '../student/common';
import { MilestoneDashboardSummary } from '../milestones/common';
export function SupervisorDashboard() {
  const { workspace, loading, error, refresh } = useSupervisor();
  if (loading || error || !workspace) return <SupervisorGate />;
  const pending = workspace.proposals.filter((item) => item.status === 'submitted');
  const approved = workspace.proposals.filter((item) => item.status === 'approved');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUPERVISOR OVERVIEW</span>
          <h1>Guide ideas into great projects.</h1>
          <p>{workspace.session_name}</p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()}>
          Refresh records
        </Button>
      </div>
      <SupervisorDataMode />
      <section className="welcome-banner">
        <div>
          <span className="welcome-kicker">REVIEW. GUIDE. MOVE FORWARD.</span>
          <h2>
            {pending.length
              ? `${pending.length} proposals need\nyour perspective.`
              : 'Your review queue\nis up to date.'}
          </h2>
          <p>Check the evidence, give clear feedback, and help each group take its next step.</p>
          <Link className="button button-light" to="/supervisor/proposals">
            Open proposal reviews
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="banner-ring" />
          <div className="banner-ring inner" />
          <div className="banner-symbol">
            <ShieldCheck size={49} strokeWidth={1.2} />
          </div>
        </div>
      </section>
      <div className="stats-grid">
        <StatisticCard
          label="Allocated groups"
          value={String(workspace.proposals.length)}
          detail="Your assigned project teams"
          icon={Users}
        />
        <StatisticCard
          label="Awaiting review"
          value={String(pending.length)}
          detail="Submitted proposals"
          icon={FileText}
        />
        <StatisticCard
          label="Capacity"
          value={`${workspace.proposals.length} / ${workspace.capacity}`}
          detail={`${Math.max(0, workspace.capacity - workspace.proposals.length)} places remaining`}
          icon={ShieldCheck}
        />
        <StatisticCard
          label="Approved projects"
          value={String(approved.length)}
          detail="Project and milestone plans"
          icon={CheckCircle2}
        />
      </div>
      <div className="supervisor-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>Proposals awaiting review</h2>
            <StatusBadge>{pending.length} pending</StatusBadge>
          </div>
          {pending.length ? (
            <div className="review-queue">
              {pending.map((item) => (
                <Link key={item.id} to={`/supervisor/proposals/${item.id}`} className="queue-item">
                  <span className="queue-icon">
                    <FileText size={20} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.group_name} · {item.members.length} students
                    </small>
                  </div>
                  <StatusBadge tone={item.similarity.status === 'flagged' ? 'amber' : 'neutral'}>
                    {item.similarity.status === 'flagged'
                      ? 'Similarity flagged'
                      : 'Ready for review'}
                  </StatusBadge>
                  <ArrowRight size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No submitted proposals awaiting review"
              description="New submissions from allocated groups will appear here."
            />
          )}
        </section>
        <section className="panel phase-form">
          <span className="eyebrow">SUPERVISOR CAPACITY</span>
          <h2>Your supervision load</h2>
          <div className="capacity-number">
            {workspace.proposals.length}
            <span> / {workspace.capacity} groups</span>
          </div>
          <meter
            min={0}
            max={Math.max(1, workspace.capacity, workspace.proposals.length)}
            value={workspace.proposals.length}
            aria-label="Supervisor group capacity"
          />
          <p className="form-hint">
            Capacity and allocation are managed by the coordinator. Your review decisions do not
            create additional allocations.
          </p>
          {workspace.proposals.length > workspace.capacity && (
            <StatusBadge tone="red">Above configured capacity · contact coordinator</StatusBadge>
          )}
          <Link className="text-link" to="/supervisor/groups">
            View all allocated groups
            <ArrowRight size={16} />
          </Link>
        </section>
      </div>
      <section className="panel supervisor-projects">
        <div className="panel-heading">
          <h2>Your allocated groups</h2>
          <Link className="text-link" to="/supervisor/groups">
            View all
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="group-preview-grid">
          {workspace.proposals.map((item) => (
            <Link className="group-preview" key={item.id} to={`/supervisor/proposals/${item.id}`}>
              <span className="eyebrow">{item.group_name}</span>
              <h3>{item.title}</h3>
              <ProposalBadge status={item.status} />
            </Link>
          ))}
        </div>
      </section>
      <MilestoneDashboardSummary />
      <HealthDashboardSummary />
    </>
  );
}

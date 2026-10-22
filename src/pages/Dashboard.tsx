import { lazy, Suspense } from 'react';
import { LoadingState } from '../components/ui';

import { coreV2 } from '../lib/backend-version';
import { ConnectedModule } from './ConnectedModule';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Flag,
  HeartPulse,
  Users,
  ShieldCheck,
  ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { demoEnabled } from '../lib/supabase';
import { EmptyState, StatisticCard, StatusBadge } from '../components/ui';
import { roleLabel, type Role } from '../types/shared';
const ReportsPage = lazy(() =>
  import('../core/CorePages').then((m) => ({ default: m.ReportsPage })),
);
const AssessmentPage = lazy(() =>
  import('../assessment/AssessmentPage').then((m) => ({ default: m.AssessmentPage })),
);

const content: Record<
  Role,
  {
    title: string;
    intro: string;
    action: string;
    target: string;
    emptyTitle: string;
    emptyDescription: string;
  }
> = {
  student: {
    title: 'Your next big idea starts here.',
    intro: 'A little clarity for every step of your final year project.',
    action: 'Explore your group workspace',
    target: 'group',
    emptyTitle: 'Your project journey is ready to begin',
    emptyDescription:
      'Start with your team, shape a proposal, and build toward your final defense.',
  },
  supervisor: {
    title: 'Guide ideas into great projects.',
    intro: 'Your groups, their progress, and the decisions that move them forward.',
    action: 'View allocated groups',
    target: 'groups',
    emptyTitle: 'A clear view of your supervision',
    emptyDescription:
      'Allocated groups and proposals will appear here when the matching module is connected.',
  },
  examiner: {
    title: 'A thoughtful review. A fair outcome.',
    intro: 'A dedicated workspace for your assigned defenses and assessments.',
    action: 'View assigned defenses',
    target: 'defenses',
    emptyTitle: 'No connected defenses yet',
    emptyDescription: 'Assigned defenses and assessments appear after coordinator scheduling.',
  },
  coordinator: {
    title: 'Keep every project moving forward.',
    intro: 'A shared view of the session, supervision, and project outcomes.',
    action: 'View configuration workspace',
    target: 'configuration',
    emptyTitle: 'Your coordination workspace is ready',
    emptyDescription: 'Configure sessions, matching, assessments and reports in your workspace.',
  },
};
export function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;
  if (!demoEnabled && user.role === 'examiner')
    return (
      <Suspense fallback={<LoadingState />}>
        <AssessmentPage />
      </Suspense>
    );
  if (!demoEnabled && coreV2 && user.role === 'coordinator')
    return (
      <Suspense fallback={<LoadingState />}>
        <ReportsPage />
      </Suspense>
    );
  if (!demoEnabled && (user.role === 'coordinator' || user.role === 'examiner'))
    return (
      <ConnectedModule moduleOverride={user.role === 'coordinator' ? 'reports' : 'defenses'} />
    );
  const page = content[user.role];
  const student = user.role === 'student';
  const supervisor = user.role === 'supervisor';
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{roleLabel[user.role].toUpperCase()} OVERVIEW</span>
          <h1>{page.title}</h1>
          <p>{page.intro}</p>
        </div>
        <StatusBadge tone="green">Phase 1 · Foundation</StatusBadge>
      </div>
      <section className="welcome-banner">
        <div>
          <span className="welcome-kicker">WELCOME, {user.full_name.toUpperCase()}</span>
          <h2>
            {student
              ? 'Every great project begins\nwith a good team.'
              : 'The right support makes\nall the difference.'}
          </h2>
          <p>
            {student
              ? 'Find your people. Define your idea. Make it happen.'
              : 'Bring clarity to each decision and each next step.'}
          </p>
          <Link className="button button-light" to={`/${user.role}/${page.target}`}>
            {page.action}
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="banner-ring" />
          <div className="banner-ring inner" />
          <div className="banner-symbol">
            <Users size={49} strokeWidth={1.2} />
          </div>
          <span className="floating-check">
            <Check size={22} />
          </span>
          <span className="banner-label">IDEA → IMPACT</span>
        </div>
      </section>
      <div className="stats-grid">
        <StatisticCard
          label={student ? 'Your group' : supervisor ? 'Allocated groups' : 'Active workspace'}
          value="—"
          detail="Awaiting connected records"
          icon={Users}
        />
        <StatisticCard
          label={student || supervisor ? 'Proposals' : 'Assessments'}
          value="—"
          detail="No connected data yet"
          icon={student || supervisor ? FileText : ClipboardCheck}
        />
        <StatisticCard
          label="Milestones"
          value="—"
          detail="Your progress will appear here"
          icon={Flag}
        />
        <StatisticCard
          label="Group health"
          value="—"
          detail="Rules connect in Phase 6"
          icon={HeartPulse}
        />
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">YOUR WORKSPACE</span>
              <h2>{student ? 'Project overview' : 'Activity overview'}</h2>
            </div>
            <StatusBadge>Not connected</StatusBadge>
          </div>
          <EmptyState
            title={page.emptyTitle}
            description={page.emptyDescription}
            action={
              <Link className="text-link" to={`/${user.role}/${page.target}`}>
                Open workspace
                <ArrowUpRight size={16} />
              </Link>
            }
          />
          <div className="panel-note">
            <ShieldCheck size={16} />
            <span>
              {demoEnabled
                ? 'Demo preview. These cards do not represent live records.'
                : 'Authentication is connected. Project data modules are coming next.'}
            </span>
          </div>
        </section>
        <section className="panel journey-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">THE ROAD AHEAD</span>
              <h2>From idea to impact</h2>
            </div>
            <Flag size={20} />
          </div>
          <ol className="journey-list">
            {[
              { title: 'Build your team', text: 'One to three students, one shared vision.' },
              { title: 'Shape your proposal', text: 'Define the idea and rank your supervisors.' },
              {
                title: 'Make steady progress',
                text: 'Submit milestones and individual contributions.',
              },
              { title: 'Present your work', text: 'Complete your defense and assessment.' },
            ].map((step, index) => (
              <li key={step.title}>
                <span className="step-number">0{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="foundation-note">
        <span className="foundation-dot" />
        <p>
          <strong>Your foundation is in place.</strong>{' '}
          {student || supervisor
            ? 'Groups, proposals, and reviews are the next build phases.'
            : 'This role’s workflow belongs to your partner’s development track.'}
        </p>
        <span>01 / 08</span>
      </div>
    </>
  );
}

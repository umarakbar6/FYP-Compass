import { ReminderPager } from './ReminderPager';
import { supabase } from '../lib/supabase';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button, EmptyState, ErrorMessage, LoadingState } from '../components/ui';
import { type Role } from '../types/shared';
import { useEngagement } from './EngagementProvider';
import { type CaseStudy } from './api';
import './engagement.css';
const checklist: Record<Role, { id: string; title: string; path: string; help: string }[]> = {
  student: [
    {
      id: 'group',
      title: 'Find or create your group',
      path: 'group',
      help: 'Use enrolled members; a group has one to three students.',
    },
    {
      id: 'proposal',
      title: 'Prepare your proposal',
      path: 'proposal',
      help: 'Choose controlled topics and three different supervisor preferences.',
    },
    {
      id: 'milestones',
      title: 'Understand milestone submissions',
      path: 'milestones',
      help: 'Upload evidence and add your own contribution statement.',
    },
    {
      id: 'feedback',
      title: 'Check feedback and notices',
      path: 'notices',
      help: 'Read supervisor feedback before reworking your evidence.',
    },
    {
      id: 'results',
      title: 'Know where results appear',
      path: 'results',
      help: 'Individual results appear only after coordinator release.',
    },
  ],
  supervisor: [
    {
      id: 'proposals',
      title: 'Review your assigned proposals',
      path: 'proposals',
      help: 'Screen similarity and explain flagged approval decisions.',
    },
    {
      id: 'milestones',
      title: 'Review evidence and contributions',
      path: 'milestones',
      help: 'Review the latest submission and every member’s statement.',
    },
    {
      id: 'health',
      title: 'Review health drafts',
      path: 'health',
      help: 'Health is calculated from fixed rules. You decide which notices to publish to students.',
    },
    {
      id: 'assessment',
      title: 'Understand supervisor marks',
      path: 'assessment',
      help: 'Respect component limits and record reasons for peer exceptions.',
    },
  ],
  examiner: [
    {
      id: 'defenses',
      title: 'Find your assigned defenses',
      path: 'defenses',
      help: 'You can see your assignments, not other examiners’ private marks.',
    },
    {
      id: 'assessment',
      title: 'Understand independent assessment',
      path: 'defenses',
      help: 'Record report, implementation and each student’s viva before submitting.',
    },
  ],
  coordinator: [
    {
      id: 'configuration',
      title: 'Configure the academic session',
      path: 'configuration',
      help: 'Set topics, enrollment, templates and supervisor capacity.',
    },
    {
      id: 'matching',
      title: 'Understand how supervisor preferences are matched',
      path: 'matching',
      help: 'Matching respects capacity; manual changes require a reason.',
    },
    {
      id: 'assessment',
      title: 'Review defense and result controls',
      path: 'assessment',
      help: 'Check readiness and two examiners. Finalization and release are separate.',
    },
    {
      id: 'reports',
      title: 'Find your session reports',
      path: 'reports',
      help: 'Reports show allocations, progress and marking evidence.',
    },
    {
      id: 'enquiries',
      title: 'Open the client enquiry inbox',
      path: 'enquiries',
      help: 'Review private requests and record how each enquiry is progressing.',
    },
  ],
};
export function HelpPage() {
  const { user } = useAuth(),
    { workspace, error, busy, reload, action } = useEngagement();
  if (!user) return null;
  const items = checklist[user.role],
    completed = items.filter((item) =>
      workspace?.onboarding.some((t) => t.task === item.id && t.completed),
    ).length;
  return (
    <div className="engagement-page">
      <div className="engagement-heading">
        <div>
          <span className="eyebrow">YOUR FIRST STEPS</span>
          <h1>Help & reminders</h1>
          <p>Useful next actions, saved onboarding progress and upcoming work.</p>
        </div>
        <Button variant="secondary" onClick={() => void reload()} disabled={busy}>
          Refresh
        </Button>
      </div>
      {error && <ErrorMessage message={error} />}
      <section className="engagement-card">
        <h2>Your onboarding checklist</h2>
        <p>
          {completed} of {items.length} steps marked complete. These ticks record your orientation,
          not academic submissions or approvals.
        </p>
        {!workspace && (
          <p role="status">
            Sign in to a connected workspace to save your checklist. The guidance and tour remain
            available.
          </p>
        )}
        <progress value={completed} max={items.length} aria-label="Onboarding progress" />
        {items.map((item) => (
          <div className="onboarding-item" key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={Boolean(
                  workspace?.onboarding.some((t) => t.task === item.id && t.completed),
                )}
                disabled={busy || !workspace}
                onChange={(e) =>
                  void action('onboarding', { task: item.id, completed: e.target.checked })
                }
              />
              <span>{item.title}</span>
            </label>
            <p>{item.help}</p>
            <Link to={`/${user.role}/${item.path}`}>Open this workspace →</Link>
          </div>
        ))}
      </section>
      <section className="engagement-card">
        <h2>Milestone reminders</h2>
        {['student', 'supervisor'].includes(user.role) ? (
          <>
            <label className="engagement-checkbox">
              <input
                type="checkbox"
                checked={workspace?.reminders_enabled ?? true}
                disabled={busy || !workspace}
                onChange={(e) => void action('reminders_enabled', { enabled: e.target.checked })}
              />
              Enable deadline reminders in your workspace
            </label>
            <p>
              Reminders cover work due within 72 hours, within 24 hours, and overdue work. Accepted
              milestones are hidden. Check current deadlines in the milestone workspace.
            </p>
            {supabase ? (
              <ReminderPager enabled={workspace?.reminders_enabled ?? true} />
            ) : workspace?.reminders.length ? (
              workspace.reminders.map((item) => (
                <article
                  className={`reminder-item ${item.read_at ? 'reminder-read' : ''}`}
                  key={item.id}
                >
                  <span className="badge">
                    {item.stage === 'overdue'
                      ? 'Overdue'
                      : item.stage === '24h'
                        ? 'Due within 24 hours'
                        : 'Due within 72 hours'}
                  </span>
                  <h3>{item.name}</h3>
                  <p>
                    {item.group_name} · due {new Date(item.deadline).toLocaleString()} ·{' '}
                    {item.status.replaceAll('_', ' ')}
                  </p>
                  <Link to={`/${user.role}/milestones`}>Open milestones →</Link>
                  {!item.read_at && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void action('read_reminder', { id: item.id })}
                    >
                      Mark as read
                    </Button>
                  )}
                </article>
              ))
            ) : (
              <EmptyState
                title={
                  workspace?.reminders_enabled === false
                    ? 'Reminders are turned off'
                    : 'No current deadline reminders'
                }
                description="Check your milestone list for the full schedule."
              />
            )}
          </>
        ) : (
          <p>
            Milestone deadline reminders are delivered to assigned students and supervisors. Use
            your assessment schedule and reports for the current session.
          </p>
        )}
      </section>
      <section className="engagement-card">
        <h2>Learn the workflow</h2>
        <p>
          Explore each role in the guided tour, or check the website FAQ for account and service
          questions.
        </p>
        <div className="engagement-actions">
          <Link className="button button-secondary" to="/demo">
            Open guided demo
          </Link>
          <Link className="button button-secondary" to="/#faq">
            Read FAQ
          </Link>
        </div>
      </section>
    </div>
  );
}
export function EnquiryInbox() {
  const { workspace, error, busy, reload, action } = useEngagement(),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const rows =
    workspace?.enquiries?.filter(
      (row) =>
        (filter === 'all' || row.status === filter) &&
        `${row.full_name} ${row.email} ${row.brief} ${row.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  return (
    <div className="engagement-page">
      <div className="engagement-heading">
        <div>
          <span className="eyebrow">CLIENT REQUESTS</span>
          <h1>Enquiry inbox</h1>
          <p>
            Private requests received from the website. Changing status does not send email or
            collect payment.
          </p>
        </div>
        <Button onClick={() => void reload()} variant="secondary" disabled={busy}>
          Refresh inbox
        </Button>
      </div>
      {error && <ErrorMessage message={error} />}
      <div className="engagement-card engagement-filters">
        <label>
          Search requests
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email, brief or reference"
          />
        </label>
        <label>
          Filter status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {['all', 'new', 'contacted', 'in_progress', 'completed', 'spam'].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!workspace && !error ? (
        <LoadingState label="Loading private enquiries…" />
      ) : rows.length ? (
        rows.map((row) => (
          <article className="engagement-card" key={row.id}>
            <div className="engagement-heading">
              <div>
                <h2>{row.full_name}</h2>
                <a href={`mailto:${encodeURIComponent(row.email)}`}>{row.email}</a>
              </div>
              <span className="badge">{row.plan}</span>
            </div>
            <p className="enquiry-brief">{row.brief}</p>
            <p className="engagement-muted">
              Reference: {row.id} · received {new Date(row.created_at).toLocaleString()}
            </p>
            <label>
              Request status
              <select
                value={row.status}
                disabled={busy}
                onChange={(e) =>
                  void action('enquiry_status', {
                    id: row.id,
                    status: e.target.value,
                    version: row.version,
                  })
                }
              >
                {['new', 'contacted', 'in_progress', 'completed', 'spam'].map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </article>
        ))
      ) : (
        <EmptyState
          title="No matching enquiries"
          description="New website submissions appear here after the database confirms receipt."
        />
      )}
      <p className="engagement-muted">
        Shows the latest 200 requests. Contact details are visible only to coordinators.
      </p>
    </div>
  );
}
const blank: CaseStudy = {
  id: '',
  title: '',
  challenge: '',
  solution: '',
  outcome: '',
  evidence: '',
  image: '/previews/coordinator-report.jpg',
  quote: '',
  attribution: '',
  consent: false,
  verified: false,
  published: false,
};
export function CaseStudyAdmin() {
  const { workspace, error, busy, reload, publishCase } = useEngagement(),
    [item, setItem] = useState<CaseStudy>({ ...blank }),
    [saved, setSaved] = useState(false);
  function field(key: keyof CaseStudy, value: string | boolean) {
    setItem((x) => ({ ...x, [key]: value }));
    setSaved(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await publishCase(item)) {
      setItem({ ...blank });
      setSaved(true);
    }
  }
  return (
    <div className="engagement-page">
      <div className="engagement-heading">
        <div>
          <span className="eyebrow">EVIDENCE, NOT INVENTED REVIEWS</span>
          <h1>Case studies</h1>
          <p>Publish verified work. Client quotes require permission and attribution.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setItem({ ...blank });
            setSaved(false);
            void reload();
          }}
        >
          New case study
        </Button>
      </div>
      {error && <ErrorMessage message={error} />}
      <div className="engagement-card">
        {workspace?.cases?.map((c) => (
          <div className="case-admin-row" key={c.id}>
            <strong>{c.title}</strong>
            <span>{c.published ? 'Published' : 'Draft'}</span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setItem(c);
                setSaved(false);
              }}
            >
              Edit
            </Button>
          </div>
        ))}
      </div>
      <form className="engagement-card case-editor" onSubmit={submit}>
        <h2>{item.id ? 'Edit case study' : 'Create case study'}</h2>
        {(['title', 'challenge', 'solution', 'outcome', 'evidence'] as const).map((key) => (
          <label key={key}>
            {key[0].toUpperCase() + key.slice(1)}
            {key === 'title' ? (
              <input
                value={item[key]}
                onChange={(e) => field(key, e.target.value)}
                minLength={3}
                maxLength={160}
                required
                disabled={busy}
              />
            ) : (
              <textarea
                value={item[key]}
                onChange={(e) => field(key, e.target.value)}
                minLength={key === 'evidence' ? 10 : 20}
                maxLength={key === 'evidence' ? 1000 : 4000}
                rows={3}
                required
                disabled={busy}
              />
            )}
          </label>
        ))}
        <label>
          Preview image
          <select
            value={item.image}
            onChange={(e) => field('image', e.target.value)}
            disabled={busy}
          >
            <option value="/previews/coordinator-report.jpg">
              Coordinator report (synthetic demo)
            </option>
            <option value="/previews/student-workspace.png">
              Student overview (synthetic demo)
            </option>
          </select>
        </label>
        <label>
          Optional genuine client quote
          <textarea
            value={item.quote}
            onChange={(e) => field('quote', e.target.value)}
            maxLength={1500}
            disabled={busy}
          />
        </label>
        <label>
          Quote attribution
          <input
            value={item.attribution}
            onChange={(e) => field('attribution', e.target.value)}
            maxLength={120}
            disabled={busy}
          />
        </label>
        {(
          [
            ['verified', 'I verified the project claims against actual work and evidence.'],
            ['consent', 'The client gave permission to publish this quote and attribution.'],
            ['published', 'Publish this case study on the website.'],
          ] as const
        ).map(([key, label]) => (
          <label className="engagement-checkbox" key={key}>
            <input
              type="checkbox"
              checked={Boolean(item[key])}
              onChange={(e) => field(key, e.target.checked)}
              disabled={busy}
            />
            {label}
          </label>
        ))}
        <Button disabled={busy || !workspace}>{busy ? 'Saving…' : 'Save case study'}</Button>
        {saved && <p role="status">Case study saved. Publication follows the selected setting.</p>}
      </form>
    </div>
  );
}

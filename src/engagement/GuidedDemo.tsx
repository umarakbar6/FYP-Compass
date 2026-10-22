import { SectionPhoto } from '../components/SectionPhoto';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Button } from '../components/ui';
import { type Role, roles, roleLabel } from '../types/shared';
const tours: Record<Role, { title: string; text: string; sample: string[] }[]> = {
  student: [
    {
      title: 'Build your group',
      text: 'Create a team of one to three enrolled students. Each person belongs to one group in the active session.',
      sample: ['Sample group: Compass Team', 'Members: Student A, Student B, Student C'],
    },
    {
      title: 'Submit your proposal',
      text: 'Explain the idea, choose controlled topics and rank three different supervisors.',
      sample: [
        'Proposal: Campus Project Hub',
        'Status: submitted for human review',
        'Preferences: Supervisor A → B → C',
      ],
    },
    {
      title: 'Track milestones',
      text: 'Upload evidence and record your own contribution. Read feedback before resubmitting work that needs changes.',
      sample: [
        'Requirements review: accepted',
        'Prototype: needs rework',
        'Next action: clarify individual contributions',
      ],
    },
    {
      title: 'Read your results',
      text: 'Your individual result becomes visible only after the coordinator releases it.',
      sample: [
        'Shared group component: 48 / 55',
        'Individual component: 38 / 45',
        'Released result: 86 / 100',
      ],
    },
  ],
  supervisor: [
    {
      title: 'Review assigned proposals',
      text: 'Only allocated groups appear. Flagged similarity requires your justification; screening never automatically rejects work.',
      sample: ['Compass Team: awaiting review', 'Action: approve, request changes or reject'],
    },
    {
      title: 'Give milestone feedback',
      text: 'Review the current evidence and every member’s contribution before accepting a milestone.',
      sample: [
        'Prototype evidence: submitted',
        'Three individual contribution statements',
        'Sample feedback: explain the testing approach',
      ],
    },
    {
      title: 'Review project health',
      text: 'Fixed rules highlight upcoming and overdue work. You review the explanation before publishing a notice to students.',
      sample: [
        'Health: AMBER',
        'Evidence: an approaching milestone deadline',
        'Notice: draft, awaiting supervisor approval',
      ],
    },
    {
      title: 'Record supervisor marks',
      text: 'Enter allowed component marks and review peer exceptions with a reason.',
      sample: [
        'Proposal: up to 10',
        'Progress: up to 15',
        'Individual progress and peer evidence remain separate',
      ],
    },
  ],
  examiner: [
    {
      title: 'Find your assigned defense',
      text: 'Your workspace shows assigned defenses rather than other examiners’ private assessments.',
      sample: ['Compass Team', 'Venue: Demo Lab', 'Schedule: sample defense appointment'],
    },
    {
      title: 'Submit an independent evaluation',
      text: 'Assess report, implementation and each student’s viva. The real system preserves submitted assessments independently.',
      sample: [
        'Report: up to 15',
        'Implementation: up to 15',
        'Individual viva: up to 20 per student',
      ],
    },
  ],
  coordinator: [
    {
      title: 'Set up the session',
      text: 'Configure topics, enrollment, milestone templates and supervisor capacity before students start.',
      sample: [
        'Session: Sample FYP Session',
        'Three enrolled students',
        'Supervisor capacity: two groups',
      ],
    },
    {
      title: 'Match supervisors',
      text: 'Matching follows supervisor preferences and available capacity. Manual allocation needs a recorded reason.',
      sample: ['Compass Team → Supervisor A', 'Preference round: 1', 'Topic tie points: 3 / 3'],
    },
    {
      title: 'Schedule and release',
      text: 'Check readiness, fee status and two distinct examiners. Finalization and release are separate decisions.',
      sample: [
        'Two assigned examiners',
        'Readiness: certified',
        'Result publication: managed by the coordinator',
      ],
    },
    {
      title: 'Support clients and report',
      text: 'Review private service enquiries and publish verified case studies. Reports show allocation and assessment evidence.',
      sample: [
        'Sample enquiry: Regular project request',
        'Request status: new',
        'Case study: verified built project',
      ],
    },
  ],
};
export function GuidedDemo() {
  const [role, setRole] = useState<Role>('student'),
    [step, setStep] = useState(0);
  const tour = tours[role],
    current = tour[step];
  return (
    <div className="services-page guided-demo">
      <header className="service-header">
        <Link to="/" aria-label="FYP Compass home">
          <Brand light />
        </Link>
        <Link className="service-portal-link" to="/login">
          Portal login
        </Link>
      </header>
      <main className="service-section">
        <div className="service-section-heading">
          <span className="service-kicker">EXPLORE BEFORE YOU SIGN IN</span>
          <h1>Take a guided tour.</h1>
          <p>
            Explore sample screens without an account. Your tour does not access or change academic
            records.
          </p>
        </div>
        <SectionPhoto
          kind={
            role === 'student'
              ? 'students'
              : role === 'coordinator'
                ? 'coordinator'
                : role === 'examiner'
                  ? 'examiner'
                  : 'supervision'
          }
          className="demo-tour-photo"
        />
        <div className="demo-role-picker" role="group" aria-label="Choose a demo role">
          {roles.map((r) => (
            <Button
              key={r}
              variant={role === r ? 'primary' : 'secondary'}
              aria-pressed={role === r}
              onClick={() => {
                setRole(r);
                setStep(0);
              }}
            >
              {roleLabel[r]}
            </Button>
          ))}
        </div>
        <div className="demo-board">
          <aside>
            <strong>{roleLabel[role]} journey</strong>
            <ol>
              {tour.map((item, index) => (
                <li key={item.title}>
                  <button
                    aria-current={step === index ? 'step' : undefined}
                    onClick={() => setStep(index)}
                  >
                    {index + 1}. {item.title}
                  </button>
                </li>
              ))}
            </ol>
            <span>ILLUSTRATIVE SAMPLE DATA</span>
          </aside>
          <section aria-live="polite">
            <span className="service-kicker">
              STEP {step + 1} OF {tour.length}
            </span>
            <h2>{current.title}</h2>
            <p>{current.text}</p>
            <div className="demo-sample">
              <span>SAMPLE WORKSPACE</span>
              {current.sample.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <div className="demo-controls">
              <Button
                variant="secondary"
                disabled={step === 0}
                onClick={() => setStep((i) => i - 1)}
              >
                Previous step
              </Button>
              {step < tour.length - 1 ? (
                <Button onClick={() => setStep((i) => i + 1)}>Next step</Button>
              ) : (
                <Button onClick={() => setStep(0)}>Start again</Button>
              )}
            </div>
          </section>
        </div>
        <p className="public-demo-link">
          <Link to="/">Back to the website</Link>
          <Link to="/login">Sign in with your assigned account</Link>
        </p>
      </main>
    </div>
  );
}

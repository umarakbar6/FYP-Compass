import { SectionPhoto, type PhotoKind } from '../components/SectionPhoto';
import { PublicEnquiry, FAQ, CaseStudies } from '../engagement/PublicEngagement';
import '../engagement/engagement.css';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Code2,
  Layers3,
  LifeBuoy,
  ShieldCheck,
  Sparkles,
  GraduationCap,
  Users,
  ClipboardCheck,
  Settings2,
  Flag,
  HeartPulse,
  FileCheck2,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { useAuth } from '../auth/AuthProvider';
import { dashboardPath } from '../types/shared';
import { Button } from '../components/ui';
const plans = [
  {
    name: 'Basic',
    price: '50',
    unit: '/ month',
    description: 'A steady starting point for your project journey.',
    features: [
      'Monthly service plan',
      'Project guidance and planning',
      'Access to the project workspace',
    ],
  },
  {
    name: 'Regular',
    price: '500',
    unit: '/ project',
    description: 'Focused delivery for a clearly defined project.',
    features: [
      'Service for one project',
      'Agreed project scope and implementation',
      'Progress reviews and project handoff',
    ],
  },
  {
    name: 'Advance',
    price: '1,000',
    unit: '/ full project',
    description: 'Complete delivery with support beyond launch.',
    features: ['Full project delivery', 'Ongoing support', 'Maintenance', 'Continuous improvement'],
  },
] as const;
const audiences = [
  {
    name: 'Students',
    icon: GraduationCap,
    description: 'Know your next step, from your first proposal to your final result.',
    features: [
      'Create a group and submit your proposal',
      'Upload milestones and record your contributions',
      'Read feedback, notices and released results',
    ],
  },
  {
    name: 'Supervisors',
    icon: Users,
    description: 'Guide your groups with the evidence and feedback in one place.',
    features: [
      'Screen and review assigned proposals',
      'Accept milestones or request rework',
      'Review project health and approve student notices',
    ],
  },
  {
    name: 'Examiners',
    icon: ClipboardCheck,
    description: 'Assess assigned defenses through a focused, independent workspace.',
    features: [
      'See your assigned defense schedule',
      'Record marks for each assessment component',
      'Submit your own independent evaluation',
    ],
  },
  {
    name: 'Coordinators',
    icon: Settings2,
    description: 'Keep the whole session moving, with clear allocation and reporting.',
    features: [
      'Configure sessions, topics and supervisor capacity',
      'Match groups and schedule defenses',
      'Release results and view accreditation reports',
    ],
  },
] as const;
const journey = [
  ['Form a team', 'Create your group and record who is working on the project.'],
  ['Submit a proposal', 'Describe your idea, choose topics and rank supervisor preferences.'],
  ['Match a supervisor', 'Get an allocation and a human review of your project proposal.'],
  [
    'Build with milestones',
    'Submit evidence, receive feedback and keep individual contributions visible.',
  ],
  [
    'Review and defend',
    'Complete peer reviews and assessment readiness before your assigned defense.',
  ],
  ['Receive results', 'View your individual result after the coordinator releases it.'],
] as const;

type PlanName = (typeof plans)[number]['name'];
export function Services() {
  const location = useLocation();
  useEffect(() => {
    const section = location.hash.slice(1) || (location.pathname === '/pricing' ? 'pricing' : null);
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [location.pathname, location.hash]);
  const { user } = useAuth();
  const [plan, setPlan] = useState<PlanName>('Regular');
  const requestRef = useRef<HTMLElement>(null);
  const selected = plans.find((p) => p.name === plan)!;
  function choose(name: PlanName) {
    setPlan(name);
    requestRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  }
  return (
    <div className="services-page">
      <a className="skip-link" href="#service-main">
        Skip to content
      </a>
      <header className="service-header">
        <Link to="/" aria-label="FYP Compass home">
          <Brand light />
        </Link>
        <nav aria-label="Service navigation">
          <a href="#platform">The platform</a>
          <a href="#workflow">How it works</a>
          <a href="#services">Services</a>
          <a href="#pricing">Pricing</a>
          <Link to={user ? dashboardPath(user.role) : '/login'} className="service-portal-link">
            {user ? 'My workspace' : 'Portal login'}
            <ArrowRight size={15} />
          </Link>
        </nav>
      </header>
      <main id="service-main">
        <section className="service-hero">
          <div className="service-hero-copy">
            <span className="service-kicker">
              <span />
              FINAL YEAR PROJECT SUPERVISION
            </span>
            <h1>
              Your final year project.
              <br />
              <span>One clear direction.</span>
            </h1>
            <p>
              Bring students, supervisors, examiners and coordinators together. Manage proposals,
              track milestones and move from your first idea to your final result in one shared
              portal.
            </p>
            <div className="service-hero-actions">
              <Link
                to={user ? dashboardPath(user.role) : '/register'}
                className="button button-light"
              >
                {user ? 'Open my workspace' : 'Create your student account'}
                <ArrowRight size={18} />
              </Link>
              <Link to="/demo" className="service-secondary-link">
                Try the guided demo
              </Link>
            </div>
            <div className="service-hero-note">
              <ShieldCheck size={17} />
              Four roles. Clear responsibilities. Shared progress.
            </div>
          </div>
          <div className="service-hero-visual">
            <SectionPhoto kind="team" eager className="hero-photo" />
            <div className="hero-image-caption">
              <span className="hero-caption-dot" />A shared workspace. A stronger project.
            </div>
          </div>
        </section>
        <section
          id="platform"
          className="service-section platform-section"
          aria-labelledby="platform-title"
        >
          <div className="service-section-heading">
            <span className="service-kicker">ONE CONNECTED WORKSPACE</span>
            <h2 id="platform-title">What is FYP Compass?</h2>
            <p>
              A final year project supervision platform for the whole academic journey. Each person
              gets a workspace built around their responsibilities, while project evidence stays
              connected.
            </p>
          </div>
          <SectionPhoto kind="mentor" className="section-wide-photo" />
          <div className="platform-benefits">
            {[
              {
                icon: Flag,
                title: 'A clear next step',
                text: 'Proposals, deadlines and milestone feedback help teams know what comes next.',
              },
              {
                icon: HeartPulse,
                title: 'Progress you can act on',
                text: 'Health checks use clear rules to help supervisors spot groups that need attention.',
              },
              {
                icon: FileCheck2,
                title: 'Evidence behind decisions',
                text: 'Submissions, contributions and assessments support a traceable project history.',
              },
            ].map(({ icon: Icon, title, text }) => (
              <article key={title}>
                <Icon size={20} aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="platform-role-heading">
            <h3>Built for every person in the project.</h3>
            <p>One platform, four focused workspaces.</p>
          </div>
          <div className="platform-roles">
            {audiences.map(({ name, icon: Icon, description, features }, index) => (
              <article className="platform-role" key={name}>
                <SectionPhoto
                  kind={
                    (['students', 'supervision', 'examiner', 'coordinator'] as PhotoKind[])[index]
                  }
                  className="role-photo"
                />
                <div className="platform-role-top">
                  <span className="platform-role-icon">
                    <Icon size={24} aria-hidden="true" />
                  </span>
                  <span className="platform-role-number">0{index + 1}</span>
                </div>
                <h3>{name}</h3>
                <p>{description}</p>
                <ul>
                  {features.map((feature) => (
                    <li key={feature}>
                      <Check size={15} aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="platform-access-note">
            <ShieldCheck size={16} aria-hidden="true" />
            Students can register with their own email and submit their own project. Staff sign in
            with their assigned account.
          </p>
        </section>
        <section
          id="workflow"
          className="service-section platform-workflow"
          aria-labelledby="workflow-title"
        >
          <div className="service-section-heading">
            <span className="service-kicker">FROM IDEA TO RESULTS</span>
            <h2 id="workflow-title">A journey everyone can follow.</h2>
            <p>Six steps connect the people, feedback and evidence behind a successful FYP.</p>
          </div>
          <SectionPhoto kind="planning" className="section-wide-photo" />
          <ol className="platform-steps">
            {journey.map(([title, description], index) => (
              <li key={title}>
                <span className="platform-step-number">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>
        <section
          id="workspace-preview"
          className="service-section platform-preview"
          aria-labelledby="preview-title"
        >
          <div className="service-section-heading">
            <span className="service-kicker">LOOK INSIDE</span>
            <h2 id="preview-title">See the workspace behind the promise.</h2>
            <p>Actual screens from our demo workspace. The examples use synthetic project data.</p>
          </div>
          <div className="platform-preview-grid">
            <figure className="platform-screen">
              <div className="platform-screen-bar">
                <span aria-hidden="true">● ● ●</span>
                <span>Student workspace</span>
              </div>
              <a
                href="/previews/student-workspace.png"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open full student workspace screenshot in a new tab"
              >
                <img
                  src="/previews/student-workspace.png"
                  width="1351"
                  height="760"
                  loading="lazy"
                  decoding="async"
                  alt="FYP Compass student overview showing the project journey, next actions and milestones in a synthetic demo."
                />
              </a>
              <figcaption>
                <strong>Keep your next step in sight.</strong>Student overview · synthetic demo
                data. Open the image for a closer look.
              </figcaption>
            </figure>
            <figure className="platform-screen">
              <div className="platform-screen-bar">
                <span aria-hidden="true">● ● ●</span>
                <span>Coordinator report</span>
              </div>
              <a
                href="/previews/coordinator-report.jpg"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open full coordinator report screenshot in a new tab"
              >
                <img
                  src="/previews/coordinator-report.jpg"
                  width="1351"
                  height="760"
                  loading="lazy"
                  decoding="async"
                  alt="FYP Compass coordinator report showing group allocations, milestone status and project health for a synthetic demo session."
                />
              </a>
              <figcaption>
                <strong>See the session as a whole.</strong>Coordinator report · synthetic demo
                data. Open the image for a closer look.
              </figcaption>
            </figure>
          </div>
          <div className="platform-preview-cta">
            <p>Already have an account? Your workspace is ready when you are.</p>
            <Link className="button button-light" to={user ? dashboardPath(user.role) : '/login'}>
              {user ? 'Open my workspace' : 'Go to portal login'}
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
        <CaseStudies />
        <section id="services" className="service-section">
          <div className="service-section-heading">
            <span className="service-kicker">WHAT WE DO</span>
            <h2>Need help planning or building?</h2>
            <p>
              Alongside the supervision portal, explore project guidance, implementation and ongoing
              support services.
            </p>
          </div>
          <div className="service-capabilities">
            {[
              {
                icon: Layers3,
                title: 'Plan your project',
                text: 'Shape the requirements, define a practical scope, and map the work ahead.',
              },
              {
                icon: Code2,
                title: 'Build your solution',
                text: 'Move from an agreed brief to implementation with clear progress reviews.',
              },
              {
                icon: LifeBuoy,
                title: 'Keep it improving',
                text: 'Choose Advance for ongoing support, maintenance, and continuous improvement.',
              },
            ].map(({ icon: Icon, title, text }, index) => (
              <article key={title}>
                <SectionPhoto
                  kind={(['guidance', 'ai', 'support'] as PhotoKind[])[index]}
                  className="capability-photo"
                />
                <span>
                  <Icon size={25} />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="pricing" className="service-section service-pricing">
          <div className="service-section-heading">
            <span className="service-kicker">SIMPLE PRICING</span>
            <h2>Three plans. One clear direction.</h2>
            <p>All prices are in USD. Choose the service that fits your project.</p>
          </div>
          <div className="service-plans">
            {plans.map((p) => (
              <article
                key={p.name}
                className={`service-plan ${p.name === 'Advance' ? 'service-plan-advance' : ''}`}
              >
                <SectionPhoto
                  kind={
                    p.name === 'Basic'
                      ? 'basic-plan'
                      : p.name === 'Regular'
                        ? 'regular-plan'
                        : 'advance-plan'
                  }
                  className="plan-photo"
                />
                <div className="service-plan-top">
                  <span className="service-plan-label">{p.name}</span>
                  {p.name === 'Advance' && (
                    <span className="service-plan-tag">
                      <Sparkles size={13} />
                      Complete service
                    </span>
                  )}
                </div>
                <div className="service-price">
                  <span>$</span>
                  <strong>{p.price}</strong>
                </div>
                <p className="service-billing">{p.unit}</p>
                <p className="service-plan-description">{p.description}</p>
                <ul>
                  {p.features.map((feature) => (
                    <li key={feature}>
                      <Check size={16} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={p.name === 'Advance' ? 'primary' : 'secondary'}
                  onClick={() => choose(p.name)}
                >
                  Choose {p.name}
                  <ArrowRight size={16} />
                </Button>
              </article>
            ))}
          </div>
          <p className="service-pricing-note">
            Basic is billed monthly. Regular and Advance are project packages. Delivery scope,
            schedule, and support terms are agreed before work begins.
          </p>
        </section>
        <section id="project-request" ref={requestRef} className="service-section service-request">
          <div className="service-request-copy">
            <SectionPhoto kind="enquiry" className="request-photo" />
            <span className="service-kicker">YOUR NEXT STEP</span>
            <h2>
              Tell us what
              <br />
              you want to build.
            </h2>
            <p>Send your selected plan and requirements directly to our coordinator inbox.</p>
            <div className="service-request-selected">
              <span>SELECTED PLAN</span>
              <strong>
                {plan}
                <small>
                  ${selected.price} {selected.unit}
                </small>
              </strong>
            </div>
            <p className="service-local-note">
              Receive a reference when your enquiry is saved. Scope, schedule and support terms are
              agreed before work begins.
            </p>
          </div>
          <PublicEnquiry plan={plan} onPlanChange={setPlan} />
        </section>
        <FAQ />
      </main>
      <footer className="service-footer">
        <Brand light />
        <span>Your FYP journey, connected. Project services when you need them.</span>
        <a href="#pricing">View pricing ↑</a>
        <p>
          <a href="/privacy">Privacy notice</a> · <a href="/terms">Service terms</a>
        </p>
      </footer>
    </div>
  );
}

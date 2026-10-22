import { SectionPhoto } from '../components/SectionPhoto';
import { Turnstile, turnstileSiteKey } from './Turnstile';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button, ErrorMessage } from '../components/ui';
import { getPublicCases, sendEnquiry, type CaseStudy } from './api';
type Plan = 'Basic' | 'Regular' | 'Advance';
const storyCopy = (text: string) =>
  text
    .replace(/(\p{L})[-\u2010\u2011\u2012\u2013\u2014](?=\p{L})/gu, '$1 ')
    .replace(/\s+[\u2013\u2014]\s+/g, ', ');
export function PublicEnquiry({
  plan,
  onPlanChange,
}: {
  plan: Plan;
  onPlanChange: (plan: Plan) => void;
}) {
  const [captchaToken, setCaptchaToken] = useState(''),
    [captchaRevision, setCaptchaRevision] = useState(0);
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [brief, setBrief] = useState(''),
    [consent, setConsent] = useState(false),
    [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState('');
  const pending = useRef(false),
    retry = useRef({ signature: '', id: '' });
  const clear = () => {
    setError('');
    setReceipt('');
  };
  function details() {
    const input = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      brief: brief.trim(),
      plan,
      consent,
      website,
    };
    if (
      input.name.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      input.brief.length < 20
    )
      throw new Error(
        'Enter your name, a valid email and at least 20 characters describing your project.',
      );
    return input;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    clear();
    try {
      const input = details();
      if (!consent) throw new Error('Agree to be contacted before sending your enquiry.');
      if (turnstileSiteKey && !captchaToken)
        throw Error('Complete the security verification before sending.');
      const signature = JSON.stringify(input);
      if (retry.current.signature !== signature)
        retry.current = { signature, id: crypto.randomUUID() };
      pending.current = true;
      setBusy(true);
      const response = await sendEnquiry({
        ...input,
        request_id: retry.current.id,
        captcha_token: captchaToken,
      });
      setReceipt(
        `Your ${input.plan} enquiry was received. Reference: ${response.reference}. A coordinator can now review your request. No payment has been taken.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to confirm your enquiry. Please retry.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
      setCaptchaToken('');
      setCaptchaRevision((v) => v + 1);
    }
  }
  function download() {
    clear();
    try {
      const input = details();
      const text = `FYP Compass enquiry copy\nPlan: ${input.plan}\nName: ${input.name}\nEmail: ${input.email}\n\n${input.brief}\n\nDownloading this copy does not send a request or take payment.\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fyp-compass-enquiry-copy.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReceipt('Your copy was downloaded. Use Send enquiry to submit it to the coordinator.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the details.');
    }
  }
  return (
    <form className="service-request-form" onSubmit={submit} onChange={clear} aria-busy={busy}>
      <Turnstile onToken={setCaptchaToken} revision={captchaRevision} />
      <label htmlFor="service-plan">Service plan</label>
      <select
        id="service-plan"
        value={plan}
        disabled={busy}
        onChange={(e) => onPlanChange(e.target.value as Plan)}
      >
        {['Basic', 'Regular', 'Advance'].map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <div className="service-form-row">
        <div>
          <label htmlFor="service-name">Your name</label>
          <input
            id="service-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={120}
            required
            disabled={busy}
            autoComplete="name"
            placeholder="Your full name"
          />
        </div>
        <div>
          <label htmlFor="service-email">Email address</label>
          <input
            id="service-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            maxLength={254}
            required
            disabled={busy}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>
      </div>
      <label htmlFor="service-brief">Project requirements</label>
      <textarea
        id="service-brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        required
        minLength={20}
        maxLength={6000}
        rows={5}
        disabled={busy}
        placeholder="Describe your idea, key features and what you need help with…"
        aria-describedby="enquiry-privacy"
      />
      <div className="enquiry-honeypot" aria-hidden="true">
        <label htmlFor="enquiry-website">Leave this field blank</label>
        <input
          id="enquiry-website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <label className="service-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
          disabled={busy}
        />
        I agree to FYP Compass using these details to respond to my enquiry.
      </label>
      <p id="enquiry-privacy" className="enquiry-privacy">
        Your contact details and brief are stored privately in the coordinator inbox. Sending an
        enquiry does not create an account, activate a plan or take payment.
      </p>
      <Button type="submit" disabled={busy}>
        {busy ? 'Sending enquiry…' : 'Send enquiry'}
        <ArrowRight size={17} />
      </Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={download}>
        Download a copy
      </Button>
      {error && <ErrorMessage message={error} />}{' '}
      {receipt && (
        <p className="service-download-success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          {receipt}
        </p>
      )}
    </form>
  );
}
const questions = [
  [
    'Who can use the portal?',
    'Students, supervisors, examiners and coordinators use accounts assigned by the project administrator. Sending an enquiry does not automatically create an account.',
  ],
  [
    'Can I explore without an account?',
    'Yes. The guided demo is public and uses isolated sample screens. It does not read or modify academic records.',
  ],
  [
    'What do the service plans cover?',
    'Basic is $50 per month for guidance, planning and workspace access. Regular is $500 per project for an agreed implementation and handoff. Advance is $1,000 for full project delivery with ongoing support, maintenance and continuous improvement.',
  ],
  [
    'Is payment collected on this website?',
    'No. An enquiry is a request to discuss the work. Scope, schedule, payment arrangements and support terms must be agreed before work begins.',
  ],
  [
    'How do I send my requirements?',
    'Choose a plan, complete the enquiry form and agree to be contacted. A successful submission shows a reference number after the coordinator inbox saves it. You can also download a copy.',
  ],
  [
    'How long do delivery and support take?',
    'The timeline and support duration depend on the agreed project scope. Confirm these with the coordinator before accepting a service.',
  ],
  [
    'How do deadline reminders work?',
    'Assigned students and supervisors can view milestone reminders in their workspace in Help & reminders. Notifications cover approaching and overdue work; accepted milestones no longer appear. You can turn reminders off in your workspace.',
  ],
  [
    'Are the case studies and screenshots real?',
    'The FYP Compass case study describes the built platform. Dashboard screenshots use synthetic demo records. External client quotes are published only after verification and permission.',
  ],
];
export function FAQ() {
  return (
    <section id="faq" className="service-section public-faq" aria-labelledby="faq-title">
      <div className="service-section-heading">
        <span className="service-kicker">CLEAR ANSWERS</span>
        <h2 id="faq-title">Before you get started.</h2>
        <p>Account access, project services and what happens next.</p>
      </div>
      <SectionPhoto kind="faq" className="faq-photo" />
      <div className="faq-list">
        {questions.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <p className="public-demo-link">
        <Link to="/demo">
          Try the guided demo
          <ArrowRight size={16} />
        </Link>
        <a href="#project-request">
          Ask about your project
          <ArrowRight size={16} />
        </a>
      </p>
    </section>
  );
}
export function CaseStudies() {
  const [cases, setCases] = useState<CaseStudy[] | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPublicCases()
      .then((data) => {
        if (!cancelled) setCases(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section
      id="case-studies"
      className="service-section public-cases"
      aria-labelledby="cases-title"
    >
      <div className="service-section-heading">
        <span className="service-kicker">BUILT WITH PURPOSE</span>
        <h2 id="cases-title">Project stories with evidence.</h2>
        <p>
          Verified published work. Demo screenshots are labelled, and client feedback requires
          permission.
        </p>
      </div>
      {error ? (
        <p className="case-status" role="status">
          Project stories are temporarily unavailable. You can still explore the workspace previews
          above.
        </p>
      ) : cases === null ? (
        <p className="case-status" role="status">
          Loading project stories…
        </p>
      ) : cases.length === 0 ? (
        <p className="case-status">
          No case studies are currently published. Explore the guided demo to see how the platform
          works.
        </p>
      ) : (
        cases.map((item) => (
          <article className="public-case" key={item.id}>
            <img
              src={item.image}
              alt={`${storyCopy(item.title)} workspace preview using synthetic demo data`}
              loading="lazy"
              width={1351}
              height={760}
            />
            <div>
              <span className="service-kicker">VERIFIED PROJECT</span>
              <h3>{storyCopy(item.title)}</h3>
              <dl>
                <dt>The challenge</dt>
                <dd>{storyCopy(item.challenge)}</dd>
                <dt>What was built</dt>
                <dd>{storyCopy(item.solution)}</dd>
                <dt>The outcome</dt>
                <dd>{storyCopy(item.outcome)}</dd>
              </dl>
              <p className="case-evidence">{storyCopy(item.evidence)}</p>
              {item.quote && (
                <blockquote>
                  {storyCopy(item.quote)}
                  <cite>{storyCopy(item.attribution)}</cite>
                </blockquote>
              )}
            </div>
          </article>
        ))
      )}
    </section>
  );
}

import { SectionPhoto } from '../components/SectionPhoto';
import { Link } from 'react-router-dom';
import { supportEmail } from '../lib/deployment';
export function Policies({ terms = false }: { terms?: boolean }) {
  return (
    <main className="engagement-page engagement-card">
      <SectionPhoto kind="mentor" className="access-page-photo" />
      <Link to="/">FYP Compass home</Link>
      <h1>{terms ? 'Service terms' : 'Privacy notice'}</h1>
      <p>
        Last updated: 16 October 2026. These are the portal's operating practices. An institution
        must approve its own applicable policies before enrolling real students.
      </p>
      {terms ? (
        <>
          <h2>Using the portal</h2>
          <p>
            Students may create an account with their own email and must verify email ownership.
            Staff accounts are assigned by the coordinator. Keep credentials private, submit work
            you are authorized to share and report suspected account misuse to the coordinator.
            Academic decisions remain with authorized staff. Staff must set up and verify their own
            authenticator before accessing project records. Synthetic demo accounts are blocked in
            the current production configuration.
          </p>
          <h2>AI assistance</h2>
          <p>
            AI produces drafts from authorized evidence selected for the assistant. This can include
            proposal text, supported documents, project health, reminders, scheduling availability
            and session totals. Staff review academic actions before publication. AI does not assign
            grades or make final academic decisions. A health provider outage may offer a clearly
            labelled rule based draft; other assistants report failures without inventing a result.
          </p>
          <h2>Services and pricing</h2>
          <p>
            Basic is $50 per month, Regular is $500 per project and Advance is $1,000 for the full
            project with support, maintenance and improvement. An enquiry is a request for
            discussion. This website does not collect payment, create a subscription or establish a
            signed service contract.
          </p>
          <h2>Availability and support</h2>
          <p>
            Saved work depends on the institution's configured cloud services. External AI and email
            providers may be unavailable. Agree delivery, support responsibilities and recovery
            procedures before client rollout.
          </p>
        </>
      ) : (
        <>
          <h2>Information the portal uses</h2>
          <p>
            The portal stores account identity and roles, enrolment, groups, proposals, uploaded
            evidence, contributions, assessments, results and approved notices. Enquiries store your
            name, email, plan and brief with consent to follow up. New verified students are
            enrolled in the current academic session and can submit their own proposal. Registration
            never grants a staff role.
          </p>
          <h2>Access and providers</h2>
          <p>
            Assigned students and staff access records permitted by their role. Supabase hosts
            authentication, database and private documents; Vercel hosts the website and reminder
            email API. With approval, Google Gemini receives the selected proposal text, supported
            uploaded documents, authorized project health and reminder evidence, scheduling context,
            session totals or the support question. The QA assistant uses a separately approved,
            fixed snapshot of selected source excerpts and sanitized test evidence. Credentials are
            excluded. Institution approval is required before sending real student data to AI.
          </p>
          <p>
            External proposal screening needs separate consent. Public search keywords, or the
            proposal title if no keywords are supplied, go to Europe PMC, Crossref and Wikipedia.
            Retrieved short passages and the proposal abstract are reviewed by Gemini. The feature
            covers retrieved abstracts and article extracts, and does not certify originality or
            search every website or paper. Approved email delivery uses the configured Gmail SMTP
            account and sends the selected message only to the registered recipient.
          </p>
          <p>
            Account and enquiry forms use Cloudflare Turnstile for security verification when
            configured. Cloudflare processes browser and network signals to produce a verification
            token. Supabase validates account tokens on the server. CAPTCHA does not replace email
            verification, role permissions or account limits. The portal does not send passwords to
            Cloudflare.
          </p>
          <h2>Security and operational records</h2>
          <p>
            Documents use private storage and expiring links. Server screening checks supported
            document content but is not a full antivirus guarantee. Minimal event categories and
            reference IDs help investigate failures. Public enquiry abuse controls store keyed
            pseudonyms rather than raw network addresses. The security dashboard records minimal
            session references, account IDs and timestamps for successful API observations. These
            security events are retained for 90 days; reviewed security alerts for 30 days.
            Background checks run every 15 minutes. This does not provide a complete log of failed
            password attempts. Authenticator setup secrets and one time codes are not sent to AI or
            included in public handover files.
          </p>
          <h2>Retention and requests</h2>
          <p>
            The institution sets retention and archive policies. Sign in and open Data requests to
            request an export, correction or deletion review for your own account. The coordinator
            records the response and any retention basis. A request or recorded response does not
            automatically delete academic records; actual changes require a controlled review and
            verification. Avoid unnecessary sensitive information in public enquiries.
          </p>
          <h2>Cookies and reminders</h2>
          <p>
            Authentication uses storage for the current browser tab, with a memory fallback when
            browser storage is blocked. Older persistent sign in state for this project is moved
            into tab storage when possible. Closing the tab can require a new login; saved academic
            work remains in the database. Scripts running on this website can still access tab
            storage, so this is not an HttpOnly cookie session. No advertising analytics are
            configured. Students and supervisors can turn off reminders in Help & reminders.
          </p>
        </>
      )}
      <h2>Contact</h2>
      <p>
        {supportEmail ? (
          <a href={'mailto:' + supportEmail}>{supportEmail}</a>
        ) : (
          "Contact the institution's FYP coordinator. Configure the institution's support contact before public enrolment."
        )}
      </p>
      <Link to={terms ? '/privacy' : '/terms'}>{terms ? 'Privacy notice' : 'Service terms'}</Link>
    </main>
  );
}

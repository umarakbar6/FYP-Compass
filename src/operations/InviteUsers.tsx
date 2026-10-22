import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { parseRoster, proposedGroups, type RosterPerson } from './roster';
import { Button, ErrorMessage } from '../components/ui';
type Capacity = {
  owner_excluded: boolean;
  limits: { role: string; maximum: number; registered: number; reserved: number }[];
};
type Roster = {
  sessions: { id: string; name: string; active: boolean }[];
  people: { id: string; full_name: string; role: string }[];
  invites: { id: string; email: string; role: string; status: string }[];
};
export function InviteUsers() {
  const { user } = useAuth();
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const inviteConfigured = import.meta.env.VITE_INVITES_ENABLED === 'true';
  const [csv, setCsv] = useState('email,full_name,role\n'),
    [preview, setPreview] = useState<RosterPerson[]>([]),
    [session, setSession] = useState(''),
    [workspace, setWorkspace] = useState<Roster | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [request, setRequest] = useState(''),
    [status, setStatus] = useState('');
  const load = useCallback(async () => {
    if (!supabase || !user?.id) return;
    const actor = user.id;
    const [rosterResult, capacityResult] = await Promise.all([
      supabase.rpc('fyp_admin_roster'),
      supabase.rpc('fyp_account_capacity'),
    ]);
    if (currentActor.current !== actor) return;
    if (rosterResult.error) {
      setError('Unable to load the private roster.');
      return;
    }
    const data = rosterResult.data;
    setWorkspace(data);
    setSession(
      (current) => current || data.sessions.find((s: { active: boolean }) => s.active)?.id || '',
    );
    const cap = capacityResult.data as Capacity | null;
    if (
      !capacityResult.error &&
      cap &&
      typeof cap.owner_excluded === 'boolean' &&
      Array.isArray(cap.limits) &&
      cap.limits.length === 3 &&
      cap.limits.every(
        (x) =>
          ['student', 'supervisor', 'coordinator'].includes(x.role) &&
          [x.maximum, x.registered, x.reserved].every((n) => Number.isSafeInteger(n) && n >= 0),
      )
    )
      setCapacity(cap);
    else setCapacity(null);
  }, [user?.id]);
  useEffect(() => {
    setWorkspace(null);
    setCapacity(null);
    void load();
  }, [load]);
  function dryRun() {
    setError('');
    setStatus('');
    setConfirmed(false);
    try {
      setPreview(parseRoster(csv));
      setRequest(crypto.randomUUID());
    } catch (cause) {
      setPreview([]);
      setError(cause instanceof Error ? cause.message : 'Check roster.');
    }
  }
  async function send() {
    if (!supabase || !confirmed || !preview.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.functions.invoke('fyp-invite-users-v1', {
        body: { csv, session_id: session, request_id: request, confirm: true },
      });
      if (error) {
        let message = 'Invitations are unavailable. Custom SMTP must be verified before delivery.';
        try {
          const body = await error.context?.json();
          if (body?.error) message = body.error;
        } catch {
          /* Keep bounded public error. */
        }
        throw Error(message);
      }
      setStatus(
        data.results
          .map((r: { email: string; status: string }) => r.email + ': ' + r.status)
          .join('\n'),
      );
      await load();
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invitation processing failed.');
    } finally {
      setBusy(false);
    }
  }
  if (user?.role !== 'coordinator') return <ErrorMessage message="Coordinator access required." />;
  return (
    <div className="engagement-page">
      <h1>Invite users</h1>
      <p>
        Preview a roster before sending invitations. Students are enrolled into the chosen session;
        supervisors need capacity configuration. Existing profiles and roles are never overwritten.
        Coordinator accounts require owner managed provisioning.
      </p>
      {error && <ErrorMessage message={error} />}
      <section className="engagement-card" aria-label="Account capacity">
        <h2>Account capacity</h2>
        <p>
          Up to 100 students, 10 supervisors and 2 coordinators. The single pinned owner account is
          separate. Existing demo accounts also count toward these totals.
        </p>
        <p>
          Unconfirmed registrations and pending staff invitations reserve places. These limits are
          enforced by the database for signup, invitation and role changes.
        </p>
        {capacity ? (
          <>
            <ul>
              {capacity.limits.map((item) => (
                <li key={item.role}>
                  {item.role}: {item.registered} registered, {item.reserved} reserved,{' '}
                  {Math.max(0, item.maximum - item.registered - item.reserved)} available out of{' '}
                  {item.maximum}
                </li>
              ))}
            </ul>
            <p>
              {capacity.owner_excluded
                ? 'Your single owner account is excluded from coordinator capacity.'
                : 'The owner exemption has not been configured.'}
            </p>
          </>
        ) : (
          <p role="status">
            Live capacity counts are currently unavailable. Server limits still apply.
          </p>
        )}
      </section>
      <section className="engagement-card">
        <label>
          Academic session
          <select
            value={session}
            onChange={(e) => {
              setSession(e.target.value);
              setConfirmed(false);
            }}
          >
            <option value="">Choose session</option>
            {workspace?.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSV roster
          <textarea
            rows={8}
            value={csv}
            disabled={busy}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview([]);
              setConfirmed(false);
            }}
          />
        </label>
        <p>
          Header: email,full_name,role, with optional group_name as a fourth column. Allowed roles:
          student, supervisor, examiner. Maximum 20 rows per batch.
        </p>
        <Button onClick={dryRun} disabled={busy}>
          Preview roster
        </Button>
        {preview.length > 0 && (
          <>
            <h2>Onboarding agent preview</h2>
            {!inviteConfigured && (
              <p>
                Invitation sending is disabled until the owner configures and verifies SMTP. The
                roster and proposed groups can be reviewed now.
              </p>
            )}
            {proposedGroups(preview).map((g) => (
              <p key={g.name}>
                Proposed group: {g.name} Â· {g.members.join(', ')}. Invitations do not automatically
                create a group; invited students confirm membership after signing in.
              </p>
            ))}
            <div className="table-wrap">
              <table>
                <caption>Proposed account invitations</caption>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.email}>
                      <td>{p.email}</td>
                      <td>{p.full_name}</td>
                      <td>{p.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="engagement-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              I checked these recipients, roles and the academic session and authorize these
              invitations.
            </label>
            <Button
              onClick={() => void send()}
              disabled={!inviteConfigured || !confirmed || !session || busy}
            >
              {busy ? 'Processingâ€¦' : 'Send confirmed invitations'}
            </Button>
          </>
        )}
        {status && (
          <p role="status" className="enquiry-brief">
            {status}
          </p>
        )}
      </section>
      <section className="engagement-card">
        <h2>Registered profiles</h2>
        {workspace?.people.map((p) => (
          <p key={p.id}>
            {p.full_name}: {p.role}
          </p>
        ))}
        <h2>Recent invitation results</h2>
        {workspace?.invites.map((i) => (
          <p key={i.id}>
            {i.email}: {i.role} Â· {i.status}
          </p>
        ))}
      </section>
    </div>
  );
}

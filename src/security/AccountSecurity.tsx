import { normaliseTotpQr } from './mfa-qr';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { localBackend } from '../lib/backend-version';
import { Button, ErrorMessage, LoadingState, ConfirmDialog } from '../components/ui';

export type SecurityContext = {
  actor_id: string;
  mfa_required: boolean;
  has_verified_factor: boolean;
  staff_mfa_required: boolean;
  demo_access_enabled: boolean;
  is_owner: boolean;
  version: number;
};
export function validateSecurityContext(value: unknown, actor: string): SecurityContext {
  const d = value as SecurityContext | null;
  if (
    !d ||
    d.actor_id !== actor ||
    ![
      'mfa_required',
      'has_verified_factor',
      'staff_mfa_required',
      'demo_access_enabled',
      'is_owner',
    ].every((k) => typeof (d as unknown as Record<string, unknown>)[k] === 'boolean') ||
    !Number.isInteger(d.version) ||
    d.version < 1
  )
    throw Error('Account security response is invalid. Retry before continuing.');
  return d;
}
export async function readSecurityContext(actor: string) {
  if (!supabase) throw Error('Connected authentication is required.');
  const { data, error } = await supabase.rpc('fyp_security_context');
  if (error) throw Error('Account security could not be verified. Retry or sign in again.');
  return validateSecurityContext(data, actor);
}

export function AuthenticatorPanel({ onVerified }: { onVerified: () => void }) {
  const { user } = useAuth();
  const [factors, setFactors] = useState<Array<{ id: string; friendly_name?: string }>>([]);
  const [selected, setSelected] = useState('');
  const [incomplete, setIncomplete] = useState<Array<{ id: string }>>([]);
  const [pending, setPending] = useState<{ id: string; qr: string } | null>(null);
  const [code, setCode] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        if (!supabase) throw Error('Connected authentication is required.');
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw Error('Your authenticators could not be loaded. Retry this page.');
        const verified = data.totp.filter((f) => f.status === 'verified');
        if (alive.current) {
          setIncomplete(
            (data.all || []).filter((f) => f.factor_type === 'totp' && f.status === 'unverified'),
          );
          setFactors(verified);
          setSelected(verified[0]?.id || '');
          setLoaded(true);
        }
      } catch (cause) {
        if (alive.current)
          setError(cause instanceof Error ? cause.message : 'Authenticator unavailable.');
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [user]);
  async function enroll() {
    if (!supabase || busy || !user) return;
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'FYP Compass authenticator',
      });
      if (error || !data)
        throw Error(
          'Setup could not start. Refresh and retry, or ask the owner to review incomplete authenticator setups.',
        );
      let qr;
      try {
        qr = normaliseTotpQr(data.totp.qr_code);
      } catch (cause) {
        if (alive.current) setIncomplete((items) => [...items, { id: data.id }]);
        throw cause;
      }
      if (alive.current) setPending({ id: data.id, qr });
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Setup unavailable.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function clearSetup(id: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (error) throw Error('Incomplete setup could not be cleared. Retry.');
      if (alive.current) {
        setIncomplete((items) => items.filter((f) => f.id !== id));
        if (pending?.id === id) setPending(null);
        setCode('');
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : 'Setup could not be cleared.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function changeCode(value: string) {
    const digits = value.replace(/\s/g, '');
    if (!/^\d{0,6}$/.test(digits)) {
      setCode('');
      setError(
        'Enter the six digit code shown inside your authenticator app. Do not paste a setup key or QR reader text.',
      );
      return;
    }
    setError('');
    setCode(digits);
  }
  async function verify() {
    const id = pending?.id || selected;
    if (!supabase || busy || !id || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code });
      if (error)
        throw Error(
          'The code was not accepted. Use the latest code from your authenticator and retry.',
        );
      if (alive.current) {
        setCode('');
        setPending(null);
        onVerified();
      }
    } catch (cause) {
      if (alive.current) {
        setCode('');
        setError(cause instanceof Error ? cause.message : 'Verification unavailable.');
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="panel phase-form" aria-label="Authenticator verification">
      <h2>{factors.length ? 'Verify your authenticator' : 'Set up your authenticator'}</h2>
      <p>
        Use a free TOTP app such as Microsoft Authenticator or Google Authenticator. Keep its
        recovery backup under your control. Never share the QR image or verification code.
      </p>
      {!loaded && !error && <LoadingState label="Loading authenticator settings…" />}
      {incomplete.length > 0 && (
        <div>
          <p>An earlier setup was not verified. Clear it before starting again.</p>
          {incomplete.map((f) => (
            <Button
              key={f.id}
              variant="secondary"
              disabled={busy}
              onClick={() => void clearSetup(f.id)}
            >
              Clear unfinished setup
            </Button>
          ))}
        </div>
      )}
      {loaded && !factors.length && !pending && incomplete.length === 0 && (
        <Button disabled={busy} onClick={() => void enroll()}>
          Set up authenticator
        </Button>
      )}
      {pending && (
        <>
          <p>
            Open Google Authenticator or Microsoft Authenticator on your phone. Choose Add account,
            then Scan QR code. Scan this image inside that app, not your normal camera or a QR
            reader. Enter the changing six digit code that appears in the app.
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => void clearSetup(pending.id)}>
            Cancel this setup
          </Button>
          <img
            src={pending.qr}
            alt="Private authenticator setup QR code"
            width={220}
            height={220}
            style={{ maxWidth: '100%', height: 'auto', background: 'white' }}
          />
        </>
      )}
      {factors.length > 1 && (
        <label>
          Authenticator
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
            {factors.map((f, i) => (
              <option key={f.id} value={f.id}>
                {f.friendly_name || 'Authenticator ' + (i + 1)}
              </option>
            ))}
          </select>
        </label>
      )}
      {(pending || factors.length > 0) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label htmlFor="authenticator-code">Authenticator code</label>
          <input
            id="authenticator-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            disabled={busy}
            aria-describedby="authenticator-code-help"
            onChange={(e) => changeCode(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              changeCode(e.clipboardData.getData('text'));
            }}
          />
          <p id="authenticator-code-help">
            Use the six numbers displayed in your authenticator app. A long setup key is not a login
            code. Keep your phone date and time automatic.
          </p>
          <Button type="submit" disabled={busy || !/^\d{6}$/.test(code)}>
            {busy ? 'Verifying…' : 'Verify authenticator'}
          </Button>
        </form>
      )}
      {error && <ErrorMessage message={error} />}
    </section>
  );
}

export function MfaBoundary({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [context, setContext] = useState<SecurityContext | null>(null),
    [error, setError] = useState('');
  const revision = useRef(0);
  const check = useCallback(async () => {
    const current = ++revision.current;
    setContext(null);
    setError('');
    if (!user) return;
    try {
      const data = await readSecurityContext(user.id);
      if (current === revision.current) setContext(data);
    } catch (cause) {
      if (current === revision.current)
        setError(cause instanceof Error ? cause.message : 'Security check unavailable.');
    }
  }, [user]);
  useEffect(() => {
    if (supabase && !localBackend) void check();
    return () => {
      revision.current++;
    };
  }, [check]);
  if (!supabase || localBackend) return children;
  if (error)
    return (
      <main className="engagement-page engagement-card">
        <ErrorMessage message={error} />
        <Button onClick={() => void check()}>Retry security check</Button>
        <Button
          variant="secondary"
          onClick={() =>
            void signOut().catch((cause) =>
              setError(cause instanceof Error ? cause.message : 'Sign out failed. Retry.'),
            )
          }
        >
          Sign out
        </Button>
      </main>
    );
  if (!context || context.actor_id !== user?.id)
    return <LoadingState label="Checking account security…" />;
  if (context.mfa_required)
    return (
      <main className="engagement-page engagement-card">
        <h1>Protect your workspace</h1>
        <p>Verify your own authenticator before accessing project records.</p>
        <AuthenticatorPanel key={user.id} onVerified={() => void check()} />
        <Button
          variant="secondary"
          onClick={() =>
            void signOut().catch((cause) =>
              setError(cause instanceof Error ? cause.message : 'Sign out failed. Retry.'),
            )
          }
        >
          Sign out
        </Button>
      </main>
    );
  return children;
}

type Alert = {
  id: string;
  kind: string;
  severity: string;
  total: number;
  created_at: string;
  reviewed_at: string | null;
};
type Staff = {
  id: string;
  full_name: string;
  role: string;
  mfa_enabled: boolean;
  demo_blocked?: boolean;
  is_owner: boolean;
};
type Dashboard = SecurityContext & {
  checked_at: string;
  observed_sessions_24h: number;
  alerts: Alert[];
  staff: Staff[];
};
const labels: Record<string, string> = {
  session_burst: 'Many new sessions observed',
  ai_failures: 'Repeated AI processing failures',
  staff_mfa_gap: 'Staff accounts need authenticators',
  demo_access: 'Demo accounts are still allowed',
};
export function AccountSecurity() {
  const { user } = useAuth();
  const [context, setContext] = useState<SecurityContext | null>(null),
    [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [requireMfa, setRequireMfa] = useState(false),
    [allowDemo, setAllowDemo] = useState(true),
    [confirm, setConfirm] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (!user) return;
    const current = ++revision.current;
    setBusy(true);
    setError('');
    setContext(null);
    setDashboard(null);
    try {
      const c = await readSecurityContext(user.id);
      let d: Dashboard | null = null;
      if (user.role === 'coordinator') {
        const response = await supabase!.rpc('fyp_security_dashboard');
        if (response.error) throw Error('The security dashboard is unavailable.');
        const value = response.data as Dashboard;
        validateSecurityContext(value, user.id);
        if (
          !Array.isArray(value.alerts) ||
          !Array.isArray(value.staff) ||
          typeof value.observed_sessions_24h !== 'number' ||
          typeof value.checked_at !== 'string' ||
          !value.alerts.every(
            (a) =>
              a &&
              typeof a.id === 'string' &&
              typeof a.kind === 'string' &&
              typeof a.severity === 'string' &&
              Number.isInteger(a.total) &&
              a.total >= 0 &&
              typeof a.created_at === 'string' &&
              (a.reviewed_at === null || typeof a.reviewed_at === 'string'),
          ) ||
          !value.staff.every(
            (s) =>
              s &&
              typeof s.id === 'string' &&
              typeof s.full_name === 'string' &&
              typeof s.role === 'string' &&
              typeof s.mfa_enabled === 'boolean' &&
              typeof s.is_owner === 'boolean',
          )
        )
          throw Error('The security dashboard response is invalid.');
        d = value;
      }
      if (current === revision.current) {
        setContext(c);
        setDashboard(d);
        setRequireMfa(c.staff_mfa_required);
        setAllowDemo(c.demo_access_enabled);
      }
    } catch (cause) {
      if (current === revision.current)
        setError(cause instanceof Error ? cause.message : 'Security settings unavailable.');
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }, [user?.id, user?.role]);
  useEffect(() => {
    void refresh();
    return () => {
      revision.current++;
    };
  }, [refresh]);
  async function save() {
    if (!supabase || !context || busy) return;
    const current = revision.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error } = await supabase.rpc('fyp_security_update', {
        p_require_staff_mfa: requireMfa,
        p_demo_access_enabled: allowDemo,
        p_version: context.version,
      });
      if (error)
        throw Error(
          error.code === '40001'
            ? 'Policy changed. Refresh and retry.'
            : 'Only the owner with a verified authenticator can save this policy.',
        );
      if (current === revision.current) {
        setConfirm(false);
        setNotice('Security policy saved.');
        await refresh();
      }
    } catch (cause) {
      if (current === revision.current)
        setError(cause instanceof Error ? cause.message : 'Policy could not be saved.');
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  async function review(id: string) {
    if (!supabase || busy) return;
    const current = revision.current;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.rpc('fyp_security_review_alert', { p_id: id });
      if (error) throw Error('Alert changed or access is unavailable. Refresh and retry.');
      if (current === revision.current) await refresh();
    } catch (cause) {
      if (current === revision.current)
        setError(cause instanceof Error ? cause.message : 'Alert review failed.');
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  async function revokeOtherSessions() {
    if (!supabase || busy) return;
    const current = revision.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      if (error) throw Error('Other sessions could not be revoked. Retry.');
      if (current === revision.current) setNotice('Other device sessions have been revoked.');
    } catch (cause) {
      if (current === revision.current)
        setError(cause instanceof Error ? cause.message : 'Other sessions could not be revoked.');
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  if (!supabase || localBackend)
    return <ErrorMessage message="Account security requires the connected production backend." />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACCOUNT SECURITY</span>
          <h1>Protect your access</h1>
          <p>Authenticators, access policies and reviewed security alerts.</p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
          Refresh security
        </Button>
      </div>
      {error && <ErrorMessage message={error} />} {notice && <p role="status">{notice}</p>}{' '}
      {busy && !context && <LoadingState />}
      {context && (
        <>
          <section className="panel phase-form">
            <h2>Your authenticator</h2>
            <p>
              {context.has_verified_factor
                ? 'An authenticator is enabled. A fresh login must verify its code before project data can be accessed.'
                : 'Your account does not have a verified authenticator yet.'}
            </p>
            <p>Account: {user?.email}</p>
            <Button variant="secondary" disabled={busy} onClick={() => void revokeOtherSessions()}>
              Sign out other devices
            </Button>
          </section>
          {!context.has_verified_factor && (
            <AuthenticatorPanel key={user?.id} onVerified={() => void refresh()} />
          )}
          {dashboard && (
            <>
              <section className="panel phase-form">
                <h2>Security alerts</h2>
                <p>
                  {dashboard.observed_sessions_24h} distinct sessions observed in the last 24 hours.
                  These are successful API observations, not a complete failed password log.
                </p>
                <p>
                  Alerts are refreshed by the database every 15 minutes and when this page is
                  opened. No student text, passwords or tokens are sent to an outside monitoring
                  service.
                </p>
                {!dashboard.alerts.length && <p>No security alerts recorded.</p>}
                {dashboard.alerts.map((a) => (
                  <article key={a.id}>
                    <h3>{labels[a.kind] || 'Security review required'}</h3>
                    <p>
                      {a.severity} · {a.total} affected · {new Date(a.created_at).toLocaleString()}
                    </p>
                    {a.reviewed_at ? (
                      <p>Reviewed {new Date(a.reviewed_at).toLocaleString()}</p>
                    ) : (
                      <Button variant="secondary" disabled={busy} onClick={() => void review(a.id)}>
                        Mark reviewed
                      </Button>
                    )}
                  </article>
                ))}
              </section>
              <section className="panel phase-form">
                <h2>Staff access review</h2>
                <p>
                  Review named staff regularly. Role changes and account closure require the
                  controlled owner procedure; this table grants no additional access.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Authenticator</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.staff.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.full_name}
                            {s.is_owner ? ' (Owner)' : ''}
                          </td>
                          <td>{s.role}</td>
                          <td>
                            {s.demo_blocked
                              ? 'Demo access blocked'
                              : s.mfa_enabled
                                ? 'Enabled'
                                : 'Setup needed'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {context.is_owner && (
            <section className="panel phase-form">
              <h2>Owner access policy</h2>
              <p>
                Set up your own authenticator first. Requiring staff MFA prompts supervisors,
                examiners and coordinators to enrol or verify before accessing project records.
                Disabling demo access blocks the synthetic demo accounts without deleting their
                data.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={requireMfa}
                  onChange={(e) => setRequireMfa(e.target.checked)}
                  disabled={busy}
                />{' '}
                Require staff authenticators
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allowDemo}
                  onChange={(e) => setAllowDemo(e.target.checked)}
                  disabled={busy}
                />{' '}
                Allow synthetic demo accounts
              </label>
              <Button
                disabled={busy || !context.has_verified_factor}
                onClick={() => setConfirm(true)}
              >
                Review access policy
              </Button>
            </section>
          )}
          <section className="panel phase-form">
            <h2>Retention and recovery</h2>
            <p>
              Security events are retained for 90 days; reviewed alerts for 30 days. Academic work
              is preserved until an authorised data request is reviewed under the institution’s
              retention policy. An alert acknowledgement does not delete an account or academic
              record.
            </p>
            <p>
              Keep an encrypted backup on a separate trusted device. Keep its recovery key
              separately. An institution must appoint a recovery contact before making MFA
              mandatory.
            </p>
          </section>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Save access policy?"
        description={
          (requireMfa
            ? 'Staff will need their own authenticator. '
            : 'Staff MFA will be optional. ') +
          (allowDemo
            ? 'Synthetic demo logins will remain allowed.'
            : 'Synthetic demo logins will be blocked; their data will be preserved.')
        }
        onConfirm={() => void save()}
        busy={busy}
      />
    </>
  );
}

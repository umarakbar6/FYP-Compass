import { EmailDeliveryCheck } from './EmailDeliveryCheck';
import { ClientErrorMonitor } from './ClientErrorMonitor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Button, ErrorMessage, LoadingState } from '../components/ui';
type Status = {
  checked_at: string;
  institution: { name: string; support_email: string; timezone: string };
  limits: { per_15_minutes: number; per_user_day: number; daily_total: number };
  ai: {
    total: number;
    gemini: number;
    fallback: number;
    failed: number;
    in_progress: number;
    interrupted: number;
    average_ms: number;
  };
  documents: { screened: number; existing: number };
  accounts: { total: number; demo: number };
  active_session: string | null;
  reminders: string | null;
};
export function OperationsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({ name: '', email: '', timezone: 'Asia/Karachi' });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++generation.current;
    setBusy(true);
    setError('');
    try {
      if (!supabase) throw new Error('Connect the portal backend to view service status.');
      const { data, error } = await supabase.rpc('fyp_ops_status');
      if (error) throw new Error('Service status is temporarily unavailable.');
      if (
        !data ||
        typeof data.checked_at !== 'string' ||
        !data.institution ||
        typeof data.institution.name !== 'string' ||
        !data.ai ||
        !data.documents ||
        !data.limits ||
        !data.accounts ||
        ![
          data.ai.total,
          data.ai.gemini,
          data.ai.fallback,
          data.ai.failed,
          data.documents.screened,
          data.limits.daily_total,
        ].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      )
        throw new Error('Service status response is invalid.');
      if (revision === generation.current) {
        setStatus(data);
        setForm({
          name: data.institution.name,
          email: data.institution.support_email,
          timezone: data.institution.timezone,
        });
      }
    } catch (cause) {
      if (revision === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not load service status.');
    } finally {
      if (revision === generation.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    setStatus(null);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, user?.id]);
  async function save() {
    if (!supabase || busy) return;
    const revision = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.rpc('fyp_ops_update_institution', {
        p_name: form.name.trim(),
        p_email: form.email.trim(),
        p_timezone: form.timezone.trim(),
      });
      if (error)
        throw new Error('Check the institution name, support email and time zone, then retry.');
      if (revision === generation.current) await refresh();
    } catch (cause) {
      if (revision === generation.current)
        setError(cause instanceof Error ? cause.message : 'Settings could not be saved.');
    } finally {
      if (revision === generation.current) setBusy(false);
    }
  }
  if (user?.role !== 'coordinator')
    return <ErrorMessage message="Coordinator access is required." />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SERVICE STATUS</span>
          <h1>Keep your workspace ready</h1>
          <p>AI usage, document screening and institution setup in one place.</p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
          Refresh status
        </Button>
      </div>
      {error && <ErrorMessage message={error} />}{' '}
      {!status && busy && <LoadingState label="Checking service status…" />}
      {status && (
        <>
          <div className="health-grid">
            <section className="panel phase-form">
              <h2>AI in the last 24 hours</h2>
              <p>
                {status.ai.total} generation attempts · {status.ai.gemini} Gemini drafts ·{' '}
                {status.ai.fallback} fallback drafts
              </p>
              <p>
                {status.ai.failed} failed saves · {status.ai.in_progress} in progress ·{' '}
                {status.ai.interrupted} unconfirmed records
              </p>
              <p>Average recorded duration: {(status.ai.average_ms / 1000).toFixed(1)} seconds.</p>
              <p className="form-hint">
                Limits: {status.limits.per_15_minutes} per supervisor in 15 minutes,{' '}
                {status.limits.per_user_day} per supervisor in 24 hours, and{' '}
                {status.limits.daily_total} total in 24 hours. Limits protect usage; they do not
                guarantee Google quota availability.
              </p>
            </section>
            <section className="panel phase-form">
              <h2>Documents and reminders</h2>
              <p>
                {status.documents.screened} uploads checked for unsafe content ·{' '}
                {status.documents.existing} existing attachments retained
              </p>
              <p className="form-hint">
                New uploads require server verification before attachment. Content screening is not
                a full antivirus guarantee.
              </p>
              <p>
                Last reminder generation:{' '}
                {status.reminders
                  ? new Date(status.reminders).toLocaleString()
                  : 'No run recorded yet'}
                .
              </p>
              <p>
                Active session:{' '}
                {status.active_session || 'Configure a session before onboarding students'}.
              </p>
            </section>
          </div>
          <section className="panel phase-form">
            <h2>Your institution</h2>
            <p className="form-hint">
              Use the institution’s actual name and support contact. Create and enrol real accounts
              through the controlled onboarding procedure before inviting a client.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <label htmlFor="institution-name">Institution name</label>
              <input
                id="institution-name"
                required
                maxLength={100}
                value={form.name}
                disabled={busy}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <label htmlFor="institution-email">Support email (optional)</label>
              <input
                id="institution-email"
                type="email"
                maxLength={254}
                value={form.email}
                disabled={busy}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <label htmlFor="institution-timezone">Time zone</label>
              <input
                id="institution-timezone"
                required
                maxLength={100}
                value={form.timezone}
                disabled={busy}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
              <Button disabled={busy} type="submit">
                Save institution settings
              </Button>
            </form>
          </section>
          <ClientErrorMonitor updated={status.checked_at} />
          <EmailDeliveryCheck key={user?.id} />
          <p className="form-hint">
            Checked {new Date(status.checked_at).toLocaleString()}. Account total:{' '}
            {status.accounts.total}. Backup and restore evidence is supplied separately in the
            deployment handover.
          </p>
        </>
      )}
    </>
  );
}

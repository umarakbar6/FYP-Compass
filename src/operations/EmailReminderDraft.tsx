import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { deliverEmail } from './email-delivery';
import { supabase } from '../lib/supabase';
import { Button, ErrorMessage } from '../components/ui';
export function EmailReminderDraft({ runId }: { runId: string }) {
  const { user } = useAuth();
  const current = useRef({ runId, actor: user?.id });
  current.current = { runId, actor: user?.id };
  const demoMailbox = /\.(?:test|invalid|example|localhost|local)$/i.test(user?.email || '');
  const enabled = import.meta.env.VITE_REMINDER_EMAIL_ENABLED === 'true' && !demoMailbox;
  const [rows, setRows] = useState<{ id: string; name: string; deadline: string }[]>([]),
    [reminder, setReminder] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState('');
  useEffect(() => {
    let active = true;
    setRows([]);
    setReminder('');
    setConfirmed(false);
    setReceipt('');
    setBusy(false);
    setError('');
    if (supabase)
      void supabase.rpc('fyp_reminders_page', { p_limit: 50 }).then(({ data, error }) => {
        if (active && !error && Array.isArray(data?.rows)) setRows(data.rows);
      });
    return () => {
      active = false;
    };
  }, [runId]);
  async function send() {
    if (!supabase || !enabled || !confirmed || !reminder || busy || !user) return;
    const actorAtSubmit = user.id;
    const stillCurrent = () =>
      current.current.runId === runId && current.current.actor === actorAtSubmit;
    setBusy(true);
    setError('');
    try {
      const reference = await deliverEmail(
        { type: 'reminder', run_id: runId, reminder_id: reminder, confirm: true },
        actorAtSubmit,
      );
      if (stillCurrent()) setReceipt('Email accepted for delivery. Reference: ' + reference);
    } catch (cause) {
      if (stillCurrent())
        setError(cause instanceof Error ? cause.message : 'Delivery unavailable.');
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }
  return (
    <section className="engagement-card">
      <h2>Approve an email reminder</h2>
      <p>
        {enabled
          ? 'The recipient is your verified registered email. Accepted work, changed deadlines and disabled reminders cannot be sent.'
          : demoMailbox
            ? 'Demo accounts have no live mailbox. Use your real account for email delivery.'
            : 'Email delivery needs a verified sender and server provider settings. Workspace reminders remain available; no message is sent from this screen until delivery is configured.'}
      </p>
      {error && <ErrorMessage message={error} />}
      <label>
        Eligible reminder
        <select
          value={reminder}
          onChange={(e) => setReminder(e.target.value)}
          disabled={!enabled || busy}
        >
          <option value="">Choose a current reminder</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {new Date(r.deadline).toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={!enabled || busy}
        />
        I approve this draft and want it sent to my registered email.
      </label>
      <Button disabled={!enabled || !confirmed || !reminder || busy} onClick={() => void send()}>
        Email approved reminder
      </Button>
      {receipt && <p role="status">{receipt}</p>}
    </section>
  );
}

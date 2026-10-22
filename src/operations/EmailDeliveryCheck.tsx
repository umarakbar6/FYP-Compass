import { useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button, ErrorMessage } from '../components/ui';
import { deliverEmail } from './email-delivery';
export function EmailDeliveryCheck() {
  const { user } = useAuth();
  const actor = useRef(user?.id);
  actor.current = user?.id;
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState(''),
    [error, setError] = useState('');
  const request = useRef(crypto.randomUUID());
  const demoMailbox = /\.(?:test|invalid|example|localhost|local)$/i.test(user?.email || '');
  const enabled = import.meta.env.VITE_REMINDER_EMAIL_ENABLED === 'true' && !demoMailbox;
  async function send() {
    if (!enabled || !confirmed || busy || !user || user.role !== 'coordinator') return;
    const id = user.id;
    setBusy(true);
    setError('');
    try {
      const reference = await deliverEmail(
        { type: 'delivery_test', request_id: request.current, confirm: true },
        id,
      );
      if (actor.current === id)
        setReceipt('Email accepted for delivery. Check your inbox. Reference: ' + reference);
    } catch (cause) {
      if (actor.current === id)
        setError(cause instanceof Error ? cause.message : 'Delivery unavailable.');
    } finally {
      if (actor.current === id) setBusy(false);
    }
  }
  if (user?.role !== 'coordinator') return null;
  return (
    <section className="engagement-card">
      <h2>Email delivery check</h2>
      <p>
        Send a fixed reminder delivery test to your own verified email. No project records are
        included. Maximum three tests per day. Interrupted SMTP attempts require reconciliation.
      </p>
      {!enabled && (
        <p>
          {demoMailbox
            ? 'Demo accounts have no live mailbox. Use your real account for email delivery.'
            : 'Email delivery is not configured.'}
        </p>
      )}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!enabled || busy || !!receipt}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I approve sending this test to my registered email.
      </label>
      <Button disabled={!enabled || !confirmed || busy || !!receipt} onClick={() => void send()}>
        {busy ? 'Sending…' : 'Send email delivery check'}
      </Button>
      {error && <ErrorMessage message={error} />}
      {receipt && <p role="status">{receipt}</p>}
    </section>
  );
}

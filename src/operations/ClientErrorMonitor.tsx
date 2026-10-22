import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
export function ClientErrorMonitor({ updated }: { updated: string }) {
  const [events, setEvents] = useState<
      { reference: string; category: string; created_at: string }[]
    >([]),
    [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    if (supabase)
      void supabase.rpc('fyp_ops_client_events').then(({ data, error }) => {
        if (active) {
          setUnavailable(Boolean(error));
          if (!error && Array.isArray(data)) setEvents(data);
        }
      });
    return () => {
      active = false;
    };
  }, [updated]);
  return (
    <section className="panel phase-form">
      <h2>Application error monitoring</h2>
      <p>
        Minimal event categories and reference IDs only. Passwords, document contents and exception
        messages are not recorded.
      </p>
      {unavailable ? (
        <p role="status">Error monitoring is temporarily unavailable.</p>
      ) : events.length ? (
        <ul>
          {events.map((e) => (
            <li key={e.reference}>
              {new Date(e.created_at).toLocaleString()} · {e.category.replaceAll('_', ' ')} ·{' '}
              {e.reference}
            </li>
          ))}
        </ul>
      ) : (
        <p>No recorded browser render failures.</p>
      )}
    </section>
  );
}

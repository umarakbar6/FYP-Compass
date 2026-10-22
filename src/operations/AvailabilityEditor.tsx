import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, ErrorMessage } from '../components/ui';
type Availability = {
  people: { id: string; name: string; role: string }[];
  windows: { id: string; profile_id: string; starts_at: string; ends_at: string }[];
};
export function AvailabilityEditor() {
  const [data, setData] = useState<Availability | null>(null),
    [person, setPerson] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (supabase)
      void supabase.rpc('fyp_schedule_availability_workspace').then(({ data, error }) => {
        if (active) {
          if (error) setError('Unable to load participant availability.');
          else setData(data);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(remove?: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = remove
        ? await supabase.rpc('fyp_schedule_remove_availability', { p_id: remove })
        : await supabase.rpc('fyp_schedule_availability', {
            p_profile_id: person,
            p_start: new Date(start).toISOString(),
            p_end: new Date(end).toISOString(),
          });
      if (result.error)
        throw Error('Check the participant and future availability window (maximum 24 hours).');
      setData(result.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Availability unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="engagement-card">
      <h2>Confirmed participant availability</h2>
      <p>
        Record availability agreed with each supervisor and examiner. The AI cannot propose a slot
        outside these windows. Rooms are supplied in the scheduler form.
      </p>
      {error && <ErrorMessage message={error} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void change();
        }}
      >
        <label>
          Participant
          <select required value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Choose a participant</option>
            {data?.people.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name} ({p.role})
              </option>
            ))}
          </select>
        </label>
        <label>
          Available from
          <input
            required
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Available until
          <input
            required
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <Button disabled={busy}>Save confirmed availability</Button>
      </form>
      {data?.windows.map((w) => (
        <p key={w.id}>
          {data.people.find((p) => p.id === w.profile_id)?.name || 'Participant'}:{' '}
          {new Date(w.starts_at).toLocaleString()} to {new Date(w.ends_at).toLocaleString()}{' '}
          <Button disabled={busy} onClick={() => void change(w.id)}>
            Remove window
          </Button>
        </p>
      ))}
    </section>
  );
}

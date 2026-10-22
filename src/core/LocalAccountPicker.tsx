import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, ErrorMessage } from '../components/ui';
import { roleLabel, isRole } from '../types/shared';
import './local-demo.css';
export function LocalAccountPicker() {
  const [accounts, setAccounts] = useState<
      { id: string; role: keyof typeof roleLabel; full_name: string }[]
    >([]),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const url = import.meta.env.VITE_SUPABASE_URL;
  useEffect(() => {
    let active = true;
    fetch(url + '/local-demo/accounts')
      .then(async (r) => {
        if (!r.ok) throw new Error('Start the local backend server first.');
        const d = await r.json();
        if (
          !d.local_only ||
          !Array.isArray(d.accounts) ||
          d.accounts.some(
            (a: { id?: unknown; role?: unknown; full_name?: unknown }) =>
              typeof a.id !== 'string' || typeof a.full_name !== 'string' || !isRole(a.role),
          )
        )
          throw new Error('Invalid local demo directory.');
        if (active) {
          setAccounts(d.accounts);
          setSelected(d.accounts[0]?.id || '');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function enter() {
    if (!supabase || busy || !selected) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(url + '/local-demo/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected }),
      });
      if (!r.ok) throw new Error('Local sign in failed.');
      const data = await r.json();
      const { error } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (error) throw error;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local sign in failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="demo-access">
      <div className="divider">
        <span>LOCAL POSTGRESQL DEMO</span>
      </div>
      <p>Shared local data across all roles. These accounts have no cloud access.</p>
      <label htmlFor="local-account">Demo account</label>
      <select
        id="local-account"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={busy}
      >
        {accounts.map((a) => (
          <option value={a.id} key={a.id}>
            {a.full_name}: {roleLabel[a.role]}
          </option>
        ))}
      </select>
      {error && <ErrorMessage message={error} />}
      <Button disabled={busy || !selected} onClick={() => void enter()}>
        {busy ? 'Signing in…' : 'Enter local backend demo'}
      </Button>
      <small>Local demo only. Live Supabase deployment requires the project owner.</small>
    </div>
  );
}

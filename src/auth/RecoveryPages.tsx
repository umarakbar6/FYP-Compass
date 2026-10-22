import { Turnstile } from '../engagement/Turnstile';
import { authCaptchaRequired, validatedCaptchaToken } from './captcha';
import { SectionPhoto } from '../components/SectionPhoto';
import { updatePasswordForSession } from './recovery';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { applicationOrigin, supportEmail } from '../lib/deployment';
import { Button, ErrorMessage } from '../components/ui';
export function ForgotPassword() {
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaRevision, setCaptchaRevision] = useState(0);
  const [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || busy || (authCaptchaRequired && !captchaToken)) return;
    setBusy(true);
    setError('');
    try {
      const token = validatedCaptchaToken(captchaToken);
      const { error: failure } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo: applicationOrigin() + '/auth/reset',
          ...(token ? { captchaToken: token } : {}),
        },
      );
      if (failure)
        throw Error(
          'The recovery email service is unavailable or busy. Please contact your coordinator or try again later.',
        );
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recovery is temporarily unavailable.');
    } finally {
      setBusy(false);
      setCaptchaToken('');
      setCaptchaRevision((n) => n + 1);
    }
  }
  return (
    <main className="engagement-page engagement-card">
      <SectionPhoto kind="mentor" className="access-page-photo" />
      <h1>Reset your password</h1>
      <p>
        Enter your registered email address. If the account is eligible, we will send a recovery
        link.
      </p>
      {sent ? (
        <p role="status">
          If an eligible account exists, a recovery link has been requested. Check your inbox and
          spam folder.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              disabled={busy || !supabase}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <Turnstile action="recovery" onToken={setCaptchaToken} revision={captchaRevision} />
          <Button disabled={busy || !supabase || (authCaptchaRequired && !captchaToken)}>
            {busy ? 'Requesting…' : 'Send recovery link'}
          </Button>
        </form>
      )}
      {error && <ErrorMessage message={error} />}
      <p>{supportEmail && <a href={'mailto:' + supportEmail}>Contact support</a>}</p>
      <Link to="/login">Back to login</Link>
    </main>
  );
}
export function ResetPassword() {
  const recoveryActor = useRef<string | null>(null);
  const [ready, setReady] = useState(false),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!supabase) {
      setError('Account recovery is unavailable.');
      return;
    }
    const check = async () => {
      const { data, error } = await supabase!.auth.getSession();
      if (active) {
        recoveryActor.current = data.session?.user.id || null;
        setReady(Boolean(data.session) && !error);
        if (!data.session || error)
          setError(
            'Open a valid invitation or recovery link from your email. Expired links require a new request.',
          );
      }
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        if (recoveryActor.current !== session?.user.id) {
          setDone(false);
          setBusy(false);
          setPassword('');
          setConfirm('');
        }
        recoveryActor.current = session?.user.id || null;
        setReady(Boolean(session));
        setError('');
      }
    });
    void check();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 12 || password.length > 128 || password !== confirm) {
      setError('Use 12 to 128 characters and enter the same password twice.');
      return;
    }
    const actorAtSubmit = recoveryActor.current;
    if (!ready || !supabase || !actorAtSubmit) return;
    setBusy(true);
    try {
      await updatePasswordForSession(supabase.auth, {
        url: import.meta.env.VITE_SUPABASE_URL,
        key: import.meta.env.VITE_SUPABASE_ANON_KEY,
        password,
        expectedActor: actorAtSubmit,
        currentActor: () => recoveryActor.current,
      });
      if (recoveryActor.current !== actorAtSubmit) return;
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch (cause) {
      if (recoveryActor.current !== actorAtSubmit) return;
      setError(cause instanceof Error ? cause.message : 'Unable to save password.');
    } finally {
      if (recoveryActor.current === actorAtSubmit) setBusy(false);
    }
  }
  return (
    <main className="engagement-page engagement-card">
      <SectionPhoto kind="mentor" className="access-page-photo" />
      <h1>Choose your password</h1>
      {done ? (
        <p role="status">Password saved. Use your new password the next time you sign in.</p>
      ) : (
        <>
          <p>
            A valid emailed invitation or recovery session is required. Use a unique password of 12
            to 128 characters.
          </p>
          <form onSubmit={submit}>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!ready || busy}
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={!ready || busy}
              />
            </label>
            <Button disabled={!ready || busy}>{busy ? 'Saving…' : 'Save password'}</Button>
          </form>
        </>
      )}
      {error && <ErrorMessage message={error} />}
      <Link to="/forgot-password">Request a new link</Link>
      <p>
        <Link to="/login">Back to login</Link>
      </p>
    </main>
  );
}

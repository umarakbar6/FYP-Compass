import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { GraduationCap, MailCheck, ShieldCheck } from 'lucide-react';
import { Turnstile } from '../engagement/Turnstile';
import { authCaptchaRequired } from './captcha';
import { useAuth } from './AuthProvider';
import {
  registerStudent,
  RegistrationRequestError,
  resendStudentConfirmation,
  verifyStudentEmailCode,
  verifyStudentEmailLink,
} from './registration';
import { supabase } from '../lib/supabase';
import { dashboardPath } from '../types/shared';
import { Brand } from '../components/Brand';
import { Button, ErrorMessage, LoadingState } from '../components/ui';
import './registration.css';

export function StudentRegistrationPage() {
  const { user, loading } = useAuth();
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaRevision, setCaptchaRevision] = useState(0);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!retryAfter) return;
    const tick = () =>
      setSecondsRemaining(Math.max(0, Math.ceil((retryAfter - Date.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [retryAfter]);
  if (loading) return <LoadingState />;
  if (user) return <Navigate to={dashboardPath(user.role)} replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || Date.now() < retryAfter || (authCaptchaRequired && !captchaToken)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await registerStudent(
        {
          fullName,
          email,
          password,
          confirmPassword,
          acceptedTerms,
        },
        captchaToken || undefined,
      );
      setPassword('');
      setConfirmPassword('');
      setSubmittedEmail(result.email);
      setRetryAfter(Date.now() + 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration is temporarily unavailable.');
      if (cause instanceof RegistrationRequestError && cause.retryDelaySeconds > 0)
        setRetryAfter(Date.now() + cause.retryDelaySeconds * 1000);
    } finally {
      setCaptchaToken('');
      setCaptchaRevision((n) => n + 1);
      lock.current = false;
      setBusy(false);
    }
  }
  async function resend() {
    if (lock.current || Date.now() < retryAfter || (authCaptchaRequired && !captchaToken)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await resendStudentConfirmation(submittedEmail, captchaToken || undefined);
      setMessage(
        'If this account needs verification, a new email has been requested. Check your inbox and spam folder.',
      );
      setRetryAfter(Date.now() + 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to request another email.');
      if (cause instanceof RegistrationRequestError && cause.retryDelaySeconds > 0)
        setRetryAfter(Date.now() + cause.retryDelaySeconds * 1000);
    } finally {
      setCaptchaToken('');
      setCaptchaRevision((n) => n + 1);
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="registration-page">
      <section className="registration-intro">
        <Link to="/" aria-label="FYP Compass home">
          <Brand light />
        </Link>
        <GraduationCap size={56} aria-hidden="true" />
        <span className="eyebrow light">YOUR IDEAS BELONG HERE</span>
        <h1>Start with your own idea.</h1>
        <p>
          Create a student account with your email and bring your real final year project into FYP
          Compass.
        </p>
        <ol>
          <li>Verify your email and enter your workspace.</li>
          <li>Create a solo project group or team of up to three.</li>
          <li>Write your proposal, upload evidence and submit for review.</li>
        </ol>
      </section>
      <section className="registration-card">
        {submittedEmail ? (
          <>
            <MailCheck size={42} aria-hidden="true" />
            <h2>Check your email</h2>
            <p role="status">
              If registration is eligible, a verification email has been requested for{' '}
              <strong>{submittedEmail}</strong>. Open its link to activate your student account.
              Existing users can sign in or reset their password.
            </p>
            <p>
              Check your spam folder as well. Keep this page open if you need to resend the email.
            </p>
            <p>
              If your email app does not open the button,{' '}
              <Link to="/auth/confirm">enter the verification code from your email</Link>.
            </p>
            <Turnstile action="resend" onToken={setCaptchaToken} revision={captchaRevision} />
            <Button
              variant="secondary"
              disabled={busy || secondsRemaining > 0 || (authCaptchaRequired && !captchaToken)}
              onClick={() => void resend()}
            >
              {secondsRemaining > 0
                ? `Resend available in ${secondsRemaining}s`
                : 'Resend verification email'}
            </Button>
            {message && <p role="status">{message}</p>}
            <p>
              <Link to="/login">Go to login</Link> ·{' '}
              <Link to="/forgot-password">Reset password</Link>
            </p>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSubmittedEmail('');
                setMessage('');
                setError('');
              }}
            >
              Use a different email
            </Button>
          </>
        ) : (
          <>
            <h2>Create your student account</h2>
            <p>Use your personal or university email. Verify it before entering the portal.</p>
            <form onSubmit={submit}>
              <label>
                Full name
                <input
                  name="full_name"
                  autoComplete="name"
                  minLength={2}
                  maxLength={120}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  aria-label="Password"
                  aria-describedby="registration-password-guidance"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={busy}
                />
                <small id="registration-password-guidance">
                  Use a unique password of 12 to 128 characters.
                </small>
              </label>
              <label>
                Confirm password
                <input
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label className="registration-consent">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(event) => setAcceptedTerms(event.target.checked)}
                  required
                  disabled={busy}
                />
                <span>
                  I agree to the <Link to="/terms">service terms</Link> and{' '}
                  <Link to="/privacy">privacy notice</Link>.
                </span>
              </label>
              <Turnstile action="signup" onToken={setCaptchaToken} revision={captchaRevision} />
              <Button
                type="submit"
                disabled={
                  busy ||
                  !supabase ||
                  secondsRemaining > 0 ||
                  (authCaptchaRequired && !captchaToken)
                }
              >
                {busy
                  ? 'Creating account…'
                  : secondsRemaining > 0
                    ? `Retry available in ${secondsRemaining}s`
                    : 'Create student account'}
              </Button>
            </form>
            <p>
              <Link to="/login">Already registered? Sign in</Link>
            </p>
            <p className="registration-role-note">
              <ShieldCheck size={18} aria-hidden="true" />
              Student access is assigned automatically. Staff accounts are managed by the
              coordinator.
            </p>
          </>
        )}
        {error && <ErrorMessage message={error} />}
      </section>
    </main>
  );
}

export function ConfirmStudentEmail() {
  const { user, loading, error } = useAuth();
  const [linkToken, setLinkToken] = useState(() => {
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get('confirmation_token') || '';
    return /^[a-f0-9]{40,128}$/i.test(value) ? value : '';
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has('confirmation_token'))
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
  }, []);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaRevision, setCaptchaRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [notice, setNotice] = useState('');
  const [verified, setVerified] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [resendAfter, setResendAfter] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!retryAfter && !resendAfter) return;
    const tick = () => {
      setSecondsRemaining(Math.max(0, Math.ceil((retryAfter - Date.now()) / 1000)));
      setResendSeconds(Math.max(0, Math.ceil((resendAfter - Date.now()) / 1000)));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [retryAfter, resendAfter]);
  const failedLink =
    new URLSearchParams(window.location.hash.slice(1)).has('error') ||
    new URLSearchParams(window.location.search).has('error');
  if (loading && !failedLink) return <LoadingState label="Verifying your email…" />;
  if (user && (!failedLink || verified)) return <Navigate to={dashboardPath(user.role)} replace />;
  async function resendCode() {
    if (
      lock.current ||
      Date.now() < retryAfter ||
      Date.now() < resendAfter ||
      (authCaptchaRequired && !captchaToken)
    )
      return;
    lock.current = true;
    setBusy(true);
    setVerificationError('');
    setNotice('');
    try {
      await resendStudentConfirmation(email, captchaToken || undefined);
      setNotice(
        'If this account needs confirmation, a new email has been requested. Check your inbox and spam folder, then use its latest code.',
      );
      setResendAfter(Date.now() + 60_000);
    } catch (cause) {
      setVerificationError(
        cause instanceof Error ? cause.message : 'Unable to request another email.',
      );
      if (cause instanceof RegistrationRequestError && cause.retryDelaySeconds)
        setRetryAfter(Date.now() + cause.retryDelaySeconds * 1000);
    } finally {
      setCaptchaToken('');
      setCaptchaRevision((value) => value + 1);
      lock.current = false;
      setBusy(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (lock.current || Date.now() < retryAfter || (authCaptchaRequired && !captchaToken)) return;
    lock.current = true;
    setBusy(true);
    setVerificationError('');
    setNotice('');
    try {
      if (linkToken) await verifyStudentEmailLink(linkToken, captchaToken || undefined);
      else await verifyStudentEmailCode(email, code, captchaToken || undefined);
      setVerified(true);
      setLinkToken('');
    } catch (cause) {
      setVerificationError(
        cause instanceof Error ? cause.message : 'Email verification is unavailable.',
      );
      if (cause instanceof RegistrationRequestError && cause.retryDelaySeconds)
        setRetryAfter(Date.now() + cause.retryDelaySeconds * 1000);
    } finally {
      setCode('');
      setCaptchaToken('');
      setCaptchaRevision((value) => value + 1);
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="engagement-page engagement-card email-confirmation-page">
      <Link to="/" aria-label="FYP Compass home">
        <Brand />
      </Link>
      <h1>{failedLink ? 'This verification link is unavailable' : 'Email verification'}</h1>
      <p>
        {failedLink
          ? 'The link may have expired or already been used. Sign in if your email is already verified, or request another verification email.'
          : 'Open the confirmation link in your latest email, or enter its verification code below. If your email is already verified, sign in.'}
      </p>
      {error && <ErrorMessage message={error} />}
      {verified ? (
        <p role="status">Your email is verified. You can now sign in to your student workspace.</p>
      ) : (
        <form onSubmit={verify}>
          <h2>{linkToken ? 'Confirm your email securely' : 'Verify with an email code'}</h2>
          <p>
            {linkToken
              ? 'Your email link is ready. Complete the security check, then press Confirm email to activate your account.'
              : 'Use the code in your latest FYP Compass confirmation email. Never share it with anyone.'}
          </p>
          {!linkToken && (
            <>
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  disabled={busy}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Email verification code
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  minLength={6}
                  maxLength={10}
                  required
                  disabled={busy}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
            </>
          )}
          <Turnstile action="signup" onToken={setCaptchaToken} revision={captchaRevision} />
          <Button
            type="submit"
            disabled={
              busy ||
              secondsRemaining > 0 ||
              (!linkToken && !/^\d{6,10}$/.test(code.trim())) ||
              (authCaptchaRequired && !captchaToken)
            }
          >
            {busy
              ? 'Verifying email...'
              : secondsRemaining > 0
                ? `Retry available in ${secondsRemaining}s`
                : 'Confirm email'}
          </Button>
          {!linkToken && (
            <Button
              type="button"
              variant="secondary"
              disabled={
                busy ||
                secondsRemaining > 0 ||
                resendSeconds > 0 ||
                !email.trim() ||
                (authCaptchaRequired && !captchaToken)
              }
              onClick={() => void resendCode()}
            >
              {resendSeconds > 0
                ? `Resend available in ${resendSeconds}s`
                : 'Send a new verification email'}
            </Button>
          )}
          {linkToken && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setLinkToken('');
                setVerificationError('');
              }}
            >
              Use an email code or request a new link
            </Button>
          )}
          {notice && <p role="status">{notice}</p>}
          {verificationError && <ErrorMessage message={verificationError} />}
        </form>
      )}
      <p>
        <Link to="/login">Sign in</Link> ·{' '}
        <Link to="/register">Register or resend verification</Link>
      </p>
    </main>
  );
}

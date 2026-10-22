import { Turnstile } from '../engagement/Turnstile';
import { authCaptchaRequired } from '../auth/captcha';
import { LocalAccountPicker } from '../core/LocalAccountPicker';
import { localBackend } from '../lib/backend-version';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Eye,
  EyeOff,
  GraduationCap,
  ShieldCheck,
  Users,
  ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { demoEnabled, supabase } from '../lib/supabase';
import { dashboardPath, roles, roleLabel } from '../types/shared';
import { Brand } from '../components/Brand';
import { Button, ErrorMessage, LoadingState } from '../components/ui';

const roleIcons = {
  student: GraduationCap,
  supervisor: Users,
  examiner: ClipboardCheck,
  coordinator: ShieldCheck,
};
export function Login() {
  const { user, loading, error: authError, signIn, enterDemo } = useAuth();
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaRevision, setCaptchaRevision] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (loading) return <LoadingState />;
  if (user) return <Navigate to={dashboardPath(user.role)} replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (authCaptchaRequired && !captchaToken)) return;
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password, captchaToken || undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed. Please try again.');
    } finally {
      setBusy(false);
      setCaptchaToken('');
      setCaptchaRevision((n) => n + 1);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand light />
        <div className="story-content">
          <span className="eyebrow light">
            <span />A CLEARER PATH TO COMPLETION
          </span>
          <h1>
            Big ideas.
            <br />
            Steady progress.
            <br />
            <em>One direction.</em>
          </h1>
          <p>
            Your final year project journey, connected. From the first proposal to the final
            defense.
          </p>
          <div className="journey-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="journey-center">
              <BookOpen size={34} strokeWidth={1.4} />
            </div>
            <span className="journey-tag tag-one">
              01 <b>Proposal</b>
            </span>
            <span className="journey-tag tag-two">
              02 <b>Progress</b>
            </span>
            <span className="journey-tag tag-three">
              03 <b>Completion</b>
            </span>
            <span className="art-dot dot-one" />
            <span className="art-dot dot-two" />
          </div>
        </div>
        <footer className="story-footer">
          <span>Built for students. Guided by supervisors.</span>
          <span>FYP / 01</span>
        </footer>
      </section>
      <section className="login-form-panel">
        <div className="login-top">
          <span>YOUR ACADEMIC WORKSPACE</span>
          <span className="small-pill">
            {localBackend ? 'Local backend demo' : demoEnabled ? 'Local preview' : 'Portal access'}
          </span>
        </div>
        <div className="login-form-wrap">
          <span className="eyebrow">LET’S GET STARTED</span>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to pick up where you left off.</p>
          {!localBackend && (
            <form onSubmit={submit}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@university.edu"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy || !supabase}
              />
              <label htmlFor="password">Password</label>
              <div className="password-field">
                <input
                  id="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={busy || !supabase}
                />
                <button
                  type="button"
                  aria-label={visible ? 'Hide password' : 'Show password'}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <Turnstile action="login" onToken={setCaptchaToken} revision={captchaRevision} />
              {(error || authError) && <ErrorMessage message={error || authError!} />}
              <Button
                className="login-submit"
                type="submit"
                disabled={busy || !supabase || (authCaptchaRequired && !captchaToken)}
              >
                {busy ? 'Signing in…' : 'Sign in to your workspace'}
                <ArrowRight size={18} />
              </Button>
            </form>
          )}
          {localBackend && authError && <ErrorMessage message={authError} />}
          {localBackend ? (
            <LocalAccountPicker />
          ) : demoEnabled ? (
            <div className="demo-access">
              <div className="divider">
                <span>EXPLORE THE DEMO</span>
              </div>
              <p>No account needed. Choose a role to explore the interface.</p>
              <div className="demo-grid">
                {roles.map((role) => {
                  const Icon = roleIcons[role];
                  return (
                    <button key={role} className="demo-role" onClick={() => enterDemo(role)}>
                      <Icon size={18} />
                      <span>{roleLabel[role]}</span>
                      <ArrowRight size={14} />
                    </button>
                  );
                })}
              </div>
              <small>Local sample workspace. No university data is connected.</small>
            </div>
          ) : (
            <p className="access-note">
              {supabase ? (
                <>
                  <Link to="/register">New student? Create your account</Link>
                  <br />
                  Staff access is managed by the FYP coordinator.
                </>
              ) : (
                'Portal setup is pending. Your team needs to configure Supabase before real sign in is available.'
              )}
            </p>
          )}
          <p>
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
          <p>
            <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
          </p>
          <Link className="login-services-link" to="/#pricing">
            Explore services and pricing
            <ArrowRight size={15} />
          </Link>
          <div className="login-trust">
            <ShieldCheck size={16} />
            <span>Your workspace follows your assigned role.</span>
          </div>
        </div>
        <footer className="login-footer">
          FYP Compass <span>From proposal to possibility.</span>
        </footer>
      </section>
    </main>
  );
}

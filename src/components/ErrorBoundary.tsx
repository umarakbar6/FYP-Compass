import { Component, type ErrorInfo, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; reference: string }
> {
  state = { failed: false, reference: '' };
  static getDerivedStateFromError() {
    return { failed: true, reference: crypto.randomUUID() };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Category and random reference only: no error text, props, student files or URLs.
    console.error(
      JSON.stringify({ event: 'browser_render_failure', reference: this.state.reference }),
    );
    if (supabase)
      void supabase
        .rpc('fyp_ops_record_client_error', {
          p_category: 'browser_render_failure',
          p_reference: this.state.reference,
        })
        .then(
          () => undefined,
          () => undefined,
        );
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="login-form-panel">
        <h1>We could not open this screen.</h1>
        <p>
          Your saved work has not been changed. Reload the page and contact your coordinator if the
          problem continues.
        </p>
        <p>Reference: {this.state.reference}</p>
        <button className="button" onClick={() => window.location.reload()}>
          Reload the page
        </button>
        <a href="/login">Return to login</a>
      </main>
    );
  }
}

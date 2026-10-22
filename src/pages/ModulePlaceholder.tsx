import { Link } from 'react-router-dom';
import { ArrowLeft, MapPinOff } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { dashboardPath } from '../types/shared';

// Keep the historical export name for route compatibility; this is a real 404 state.
export function ModulePlaceholder() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE NAVIGATION</span>
          <h1>Page not found</h1>
          <p>This page does not exist in your workspace.</p>
        </div>
      </div>
      <section className="panel module-placeholder">
        <span className="empty-icon">
          <MapPinOff size={30} />
        </span>
        <h2>Let’s get you back on track.</h2>
        <p>Return to your overview to continue your project.</p>
        <Link className="button button-secondary" to={dashboardPath(user.role)}>
          <ArrowLeft size={17} />
          Back to overview
        </Link>
      </section>
    </>
  );
}

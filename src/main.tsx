import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { LoadingState } from './components/ui';

import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import './theme.css';
import './student/student.css';
import './supervisor/supervisor.css';
import './milestones/milestones.css';
const App = lazy(() => import('./App'));
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<LoadingState label="Opening FYP Compass…" />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);

import './pages/services.css';

import './professional.css';

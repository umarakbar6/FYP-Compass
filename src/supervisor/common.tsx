import { Button, ErrorMessage, LoadingState } from '../components/ui';
import { demoEnabled } from '../lib/supabase';
import { useSupervisor } from './SupervisorProvider';
export function SupervisorGate() {
  const { loading, workspace, error, refresh } = useSupervisor();
  return loading ? (
    <LoadingState label="Loading your supervision workspace…" />
  ) : error || !workspace ? (
    <>
      <ErrorMessage message={error || 'Your supervision records are unavailable.'} />
      <Button onClick={() => void refresh()}>Try again</Button>
    </>
  ) : null;
}
export function SupervisorDataMode() {
  return (
    <div className="phase-data-note">
      {demoEnabled
        ? 'Prepared supervisor demo · reviews persist in this browser. Allocated groups use prepared scenarios; similarity is calculated from stored proposal text. These groups remain separate from the student demo until backend integration.'
        : 'Your assigned groups and review records are loaded from the connected portal.'}
    </div>
  );
}
export const dateLabel = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(value))
    : 'Date unavailable';

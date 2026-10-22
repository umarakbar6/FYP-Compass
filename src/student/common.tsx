import { useStudent } from './StudentProvider';
import { Button, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import { demoEnabled } from '../lib/supabase';
export function WorkspaceGate() {
  const { loading, error, workspace, refresh } = useStudent();
  return loading ? (
    <LoadingState label="Loading your student workspace…" />
  ) : error || !workspace ? (
    <>
      <ErrorMessage message={error || 'Your workspace is unavailable.'} />
      <Button onClick={() => void refresh()}>Try again</Button>
    </>
  ) : null;
}
export function DataMode() {
  return (
    <div className="phase-data-note">
      {demoEnabled
        ? 'Local demo · your group and proposal are saved in this browser. Matching is awaiting your partner’s module.'
        : 'Connected workspace · groups, proposals and allocations come from Supabase.'}
    </div>
  );
}
export function ProposalBadge({ status }: { status: string }) {
  return (
    <StatusBadge
      tone={
        status === 'approved'
          ? 'green'
          : status === 'rejected'
            ? 'red'
            : status === 'changes_requested'
              ? 'amber'
              : 'neutral'
      }
    >
      {status.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase())}
    </StatusBadge>
  );
}

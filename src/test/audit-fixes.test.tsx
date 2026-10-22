import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { FileUploader } from '../components/ui';
import { PrivateDocumentLink } from '../components/PrivateDocumentLink';
import { useWorkspace } from '../lib/use-workspace';
import {
  createGroup,
  initialWorkspace,
  loadWorkspace,
  saveProposal,
  validateWorkspace,
} from '../lib/student-api';
import {
  initialMilestoneProjects,
  loadMilestoneWorkspace,
  validateMilestoneWorkspace,
} from '../lib/milestone-api';
import type { PortalUser } from '../types/shared';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true, backendError: null }));
const user: PortalUser = {
  id: 'demo-student',
  full_name: 'Ayesha Khan',
  role: 'student',
  email: 'audit@example.com',
};
it('rejects empty documents in the shared picker and proposal adapter', async () => {
  const onSelect = vi.fn();
  render(<FileUploader onSelect={onSelect} />);
  const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText(/Choose a document/), { target: { files: [empty] } });
  expect(screen.getByRole('alert')).toHaveTextContent('The document is empty');
  expect(onSelect).toHaveBeenLastCalledWith(null);
  await createGroup(user, 'Audit team', []);
  await expect(
    saveProposal(
      user,
      {
        title: 'Audit project',
        abstract: 'Scope',
        keywords: ['audit'],
        topic_ids: ['web'],
        supervisor_ids: ['supervisor-ahmed', 'supervisor-sara', 'supervisor-hassan'],
      },
      empty,
      true,
    ),
  ).rejects.toThrow(/with content/);
  expect((await loadWorkspace(user)).proposal).toBeNull();
});
it('rejects duplicate students and absent actor membership without rejecting valid empty/group snapshots', () => {
  const value = initialWorkspace();
  expect(validateWorkspace(value, user).group).toBeNull();
  value.group = { id: 'audit-group', name: 'Team', session_id: 'demo-session', members: [user] };
  expect(validateWorkspace(value, user).group?.members).toHaveLength(1);
  value.group.members = [user, user];
  expect(() => validateWorkspace(value, user)).toThrow(/workspace response is invalid/);
  value.group.members = [{ ...user, id: 'outsider' }];
  expect(() => validateWorkspace(value, user)).toThrow(/workspace response is invalid/);
});
it('handles null contribution entries with a controlled contract error', () => {
  const projects = initialMilestoneProjects();
  projects[0].milestones[0].submissions[0].contributions = [null] as never;
  expect(() => validateMilestoneWorkspace({ actor_id: user.id, projects }, user)).toThrow(
    'Milestone records are invalid. Check the Phase 4 backend contract.',
  );
});
it.each([
  '[null]',
  '[{"supervisor_id":"demo-supervisor","members":null}]',
  '[{"supervisor_id":"demo-supervisor","members":[null]}]',
])('recovers from malformed stored milestone projects: %s', async (stored) => {
  localStorage.setItem('fyp-compass.milestones.v1', stored);
  await expect(loadMilestoneWorkspace(user)).rejects.toThrow(
    'Saved milestone demo data could not be read. Enable storage or clear this site’s milestone demo data.',
  );
});
it('expires cached links and supports regeneration and retry without reloading', async () => {
  vi.useFakeTimers();
  try {
    const resolveUrl = vi
      .fn()
      .mockResolvedValueOnce('https://example.com/private-1')
      .mockRejectedValueOnce(new Error('Temporary Storage error'))
      .mockResolvedValueOnce('https://example.com/private-2');
    render(
      <PrivateDocumentLink
        document={{ name: 'proposal.pdf', path: 'student/group/proposal.pdf', size: 100 }}
        resolveUrl={resolveUrl}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Get private document link' }));
    });
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/private-1');
    expect(screen.getByRole('button', { name: 'Refresh private link' })).toBeEnabled();
    act(() => vi.advanceTimersByTime(60001));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Get private document link' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Temporary Storage error');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Get private document link' }));
    });
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/private-2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(resolveUrl).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('ignores out-of-order refresh responses and stale failures', async () => {
  const old = deferred<string>();
  const fresh = deferred<string>();
  const newer = deferred<string>();
  const load = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
    .mockReturnValueOnce(newer.promise);
  const { result } = renderHook(() => useWorkspace(user, load, 'Unavailable'));
  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.refresh();
  });
  await act(async () => {
    fresh.resolve('fresh');
    await refresh;
  });
  expect(result.current.workspace).toBe('fresh');
  await act(async () => {
    old.resolve('stale');
  });
  expect(result.current.workspace).toBe('fresh');
  const stale = deferred<string>();
  load.mockReturnValueOnce(stale.promise);
  act(() => {
    void result.current.refresh();
  });
  let final!: Promise<void>;
  act(() => {
    final = result.current.refresh();
  });
  await act(async () => {
    stale.resolve('newest');
    await final;
  });
  await act(async () => {
    newer.reject(new Error('Old failure'));
  });
  expect(result.current.workspace).toBe('newest');
  expect(result.current.error).toBe('');
  expect(result.current.loading).toBe(false);
});
it('protects writes from earlier reads, overlapping refreshes and duplicate writes', async () => {
  const old = deferred<string>();
  const write = deferred<string>();
  const load = vi.fn().mockReturnValue(old.promise);
  const { result } = renderHook(() => useWorkspace(user, load, 'Unavailable'));
  let mutation!: Promise<void>;
  act(() => {
    mutation = result.current.mutate(() => write.promise);
  });
  await act(async () => {
    await result.current.refresh();
  });
  expect(load).toHaveBeenCalledTimes(1);
  await expect(result.current.mutate(async () => 'duplicate')).rejects.toThrow(
    /already in progress/,
  );
  await act(async () => {
    write.resolve('saved');
    await mutation;
    old.resolve('old snapshot');
  });
  expect(result.current.workspace).toBe('saved');
  expect(result.current.error).toBe('');
});

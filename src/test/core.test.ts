import { reportSummary, type CoreReport } from '../core/api';
it('reports session totals without counting archived data or unpublished completion', () => {
  const r = {
    groups: [
      {
        id: 'a',
        session_id: 's',
        members: [],
        proposal: { submitted_at: 'date' },
        allocation: { preference_rank: 1 },
      },
      {
        id: 'b',
        session_id: 's',
        members: [],
        proposal: { submitted_at: 'date' },
        allocation: null,
      },
      {
        id: 'old',
        session_id: 'past',
        members: [],
        proposal: { submitted_at: 'date' },
        allocation: { preference_rank: 1 },
      },
    ],
    participants: [
      { profile_id: 'one', session_id: 's' },
      { profile_id: 'two', session_id: 's' },
      { profile_id: 'old-user', session_id: 'past' },
    ],
    people: [
      { id: 'one', role: 'student' },
      { id: 'two', role: 'student' },
      { id: 'old-user', role: 'student' },
    ],
    results: [
      { project_id: 'a', released_at: 'date' },
      { project_id: 'b', released_at: null },
      { project_id: 'old', released_at: 'date' },
    ],
    peer_reviews: [
      { project_id: 'a', students: [{ status: 'pending_review' }] },
      { project_id: 'old', students: [{ status: 'pending_review' }] },
    ],
  } as unknown as CoreReport;
  const s = reportSummary(r, 's');
  expect(s.groups.length).toBe(2);
  expect(s.students).toBe(2);
  expect(s.unmatched).toBe(1);
  expect(s.preferenceRates).toEqual([100, 0, 0]);
  expect(s.completion).toBe(50);
  expect(s.pendingPeers).toBe(1);
});
it('handles an empty session without invalid allocation percentages', () => {
  const r = {
    groups: [],
    participants: [],
    people: [],
    results: [],
    peer_reviews: [],
  } as unknown as CoreReport;
  const s = reportSummary(r, 'empty');
  expect(s.completion).toBe(0);
  expect(s.preferenceRates).toEqual([0, 0, 0]);
  expect(s.students).toBe(0);
});

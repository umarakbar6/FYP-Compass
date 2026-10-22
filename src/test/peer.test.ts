import { validatePeerWorkspace } from '../peer/api';
import type { PortalUser } from '../types/shared';
const student: PortalUser = { id: 'a', role: 'student', full_name: 'A', email: 'a@example.test' };
const data = () => ({
  actor_id: 'a',
  projects: [
    {
      id: 'p',
      title: 'Project',
      members: [
        { id: 'a', full_name: 'A' },
        { id: 'b', full_name: 'B' },
      ],
      peers_required: true,
      my_ratings: [{ evaluated: 'b', rating: 4 }],
      contribution_percents: [],
    },
  ],
});
it('accepts own confidential submitted ratings', () =>
  expect(validatePeerWorkspace(data(), student).projects[0].my_ratings[0].rating).toBe(4));
it('rejects another actor, group and private supervisor percentages', () => {
  const actor = data();
  actor.actor_id = 'b';
  expect(() => validatePeerWorkspace(actor, student)).toThrow();
  const group = data();
  group.projects[0].members[0].id = 'c';
  expect(() => validatePeerWorkspace(group, student)).toThrow();
  const privateData = {
    ...data(),
    projects: [
      { ...data().projects[0], contribution_percents: [{ student_id: 'a', percent: 50 }] },
    ],
  };
  expect(() => validatePeerWorkspace(privateData, student)).toThrow();
});
it('rejects self ratings, duplicate ratings and invalid score ranges', () => {
  for (const rating of [0, 6, NaN, 1.5]) {
    const w = data();
    w.projects[0].my_ratings[0].rating = rating;
    expect(() => validatePeerWorkspace(w, student)).toThrow();
  }
  const w = data();
  w.projects[0].my_ratings[0].evaluated = 'a';
  expect(() => validatePeerWorkspace(w, student)).toThrow();
  const duplicate = data();
  duplicate.projects[0].my_ratings.push(duplicate.projects[0].my_ratings[0]);
  expect(() => validatePeerWorkspace(duplicate, student)).toThrow();
});

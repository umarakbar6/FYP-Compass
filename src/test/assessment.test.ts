import { validateAssessmentWorkspace } from '../assessment/api';
import type { PortalUser } from '../types/shared';
const student: PortalUser = { id: 'a', full_name: 'A', email: 'a@example.test', role: 'student' };
const result = () => ({
  id: 'r',
  defense_id: 'd',
  student_id: 'a',
  group_components: { proposal: 8, progress: 12, report: 13, implementation: 14 },
  individual_components: { contribution: 15, viva: 20, peer: 8 },
  group_mark: 47,
  individual_mark: 43,
  total: 90,
  version: 1,
  released_at: '2026-10-08T12:00:00Z',
});
const workspace = () => ({
  actor_id: 'a',
  projects: [],
  defenses: [],
  results: [result()],
  examiners: [],
});
it('accepts only an own released result with valid 55/45 totals', () =>
  expect(validateAssessmentWorkspace(workspace(), student).results[0].total).toBe(90));
it('rejects unreleased/other-student results and a different actor', () => {
  const hidden = { ...workspace(), results: [{ ...result(), released_at: null }] };
  expect(() => validateAssessmentWorkspace(hidden, student)).toThrow();
  const other = { ...workspace(), results: [{ ...result(), student_id: 'b' }] };
  expect(() => validateAssessmentWorkspace(other, student)).toThrow();
  expect(() => validateAssessmentWorkspace({ ...workspace(), actor_id: 'b' }, student)).toThrow();
});
it('rejects out-of-range and inconsistent component totals', () => {
  for (const changes of [
    { group_mark: 56 },
    { individual_mark: 46 },
    { total: 89 },
    { total: NaN },
  ])
    expect(() =>
      validateAssessmentWorkspace(
        { ...workspace(), results: [{ ...result(), ...changes }] },
        student,
      ),
    ).toThrow();
});
it('rejects another examiner assessment and unassigned defense', () => {
  const examiner = { ...student, role: 'examiner' as const };
  const defense = {
    id: 'd',
    project_id: 'p',
    title: 'Project',
    members: [{ id: 's', full_name: 'S' }],
    scheduled_at: '2026-10-08T12:00:00Z',
    location: 'Room',
    fee_paid: true,
    examiner_one: 'a',
    examiner_two: 'b',
    submitted_examiners: [],
    my_assessment: { examiner: 'b' },
  };
  expect(() =>
    validateAssessmentWorkspace({ ...workspace(), results: [], defenses: [defense] }, examiner),
  ).toThrow();
  expect(() =>
    validateAssessmentWorkspace(
      {
        ...workspace(),
        results: [],
        defenses: [{ ...defense, my_assessment: null, examiner_one: 'c' }],
      },
      examiner,
    ),
  ).toThrow();
});

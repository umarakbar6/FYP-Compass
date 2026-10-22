import {
  componentCaps,
  validateGovernanceWorkspace,
  validateRubric,
  type Rubric,
} from '../governance/api';
import type { PortalUser } from '../types/shared';

const student: PortalUser = {
  id: 'student-one',
  full_name: 'Student One',
  email: 'student@example.test',
  role: 'student',
};
const rubric = (): Rubric => ({
  id: 'rubric-one',
  version: 1,
  name: 'Evidence based rubric',
  description: 'Versioned criteria',
  created_at: '2026-10-14T10:00:00Z',
  criteria: Object.entries(componentCaps).map(([component, points]) => ({
    id: `${component}_quality`,
    component: component as keyof typeof componentCaps,
    label: `${component} quality`,
    guidance: 'Assess the submitted evidence.',
    points,
  })),
});

it('accepts a complete rubric whose criterion totals match every component cap', () => {
  expect(validateRubric(rubric()).criteria).toHaveLength(6);
});

it('rejects incomplete, duplicate or incorrectly weighted rubric evidence', () => {
  expect(() => validateRubric({ ...rubric(), criteria: rubric().criteria.slice(1) })).toThrow();
  expect(() =>
    validateRubric({
      ...rubric(),
      criteria: rubric().criteria.map((item, index) =>
        index === 0 ? { ...item, points: item.points - 1 } : item,
      ),
    }),
  ).toThrow();
  expect(() =>
    validateRubric({
      ...rubric(),
      criteria: rubric().criteria.map((item) => ({ ...item, id: 'duplicate_id' })),
    }),
  ).toThrow();
});

it('accepts only meetings and feedback belonging to the returned project scope', () => {
  const workspace = {
    actor_id: student.id,
    role: 'student',
    projects: [
      {
        id: 'project-one',
        name: 'Team One',
        title: 'Project One',
        supervisor_id: 'supervisor-one',
        members: [{ id: student.id, full_name: student.full_name }],
      },
    ],
    active_rubric: rubric(),
    rubrics: [],
    meetings: [
      {
        id: 'meeting-one',
        group_id: 'project-one',
        starts_at: '2026-10-20T10:00:00Z',
        duration_minutes: 45,
        location: 'Room One',
        agenda: 'Review progress',
        status: 'requested',
        minutes: null,
        decisions: [],
        action_items: [],
        created_by: student.id,
        version: 1,
      },
    ],
    feedback: [
      {
        id: 'feedback-one',
        group_id: 'project-one',
        source_type: 'general',
        source_id: 'source-one',
        title: 'Clarify evaluation method',
        details: 'Add a reproducible evaluation section.',
        status: 'open',
        student_response: null,
        created_by: 'supervisor-one',
        version: 1,
        created_at: '2026-10-14T10:00:00Z',
      },
    ],
  };
  expect(validateGovernanceWorkspace(workspace, student).feedback).toHaveLength(1);
  expect(() =>
    validateGovernanceWorkspace(
      { ...workspace, meetings: [{ ...workspace.meetings[0], group_id: 'other-project' }] },
      student,
    ),
  ).toThrow();
  expect(() => validateGovernanceWorkspace({ ...workspace, actor_id: 'other' }, student)).toThrow();
});

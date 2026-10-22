import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../lib/use-workspace';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import { loadAssessmentWorkspace, updateAssessment } from './api';
import {
  criteriaFor,
  loadActiveRubric,
  type Rubric,
  type RubricComponent,
} from '../governance/api';
import './assessment.css';
function Field({
  name,
  label,
  max,
  value,
}: {
  name: string;
  label: string;
  max: number;
  value?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        name={name}
        min="0"
        max={max}
        step="0.01"
        required
        defaultValue={value ?? ''}
      />
    </label>
  );
}
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="assessment-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function RubricFields({
  rubric,
  component,
  prefix = '',
}: {
  rubric: Rubric;
  component: RubricComponent;
  prefix?: string;
}) {
  return criteriaFor(rubric, component).map((criterion) => (
    <label key={prefix + criterion.id}>
      {criterion.label} / {criterion.points}
      <input
        type="number"
        name={`${prefix}${component}:${criterion.id}`}
        min="0"
        max={criterion.points}
        step="0.01"
        required
      />
      {criterion.guidance && <small>{criterion.guidance}</small>}
    </label>
  ));
}
function rubricScores(form: FormData, rubric: Rubric, component: RubricComponent, prefix = '') {
  return Object.fromEntries(
    criteriaFor(rubric, component).map((criterion) => [
      criterion.id,
      Number(form.get(`${prefix}${component}:${criterion.id}`)),
    ]),
  );
}
export function AssessmentPage() {
  const { user } = useAuth();
  const state = useWorkspace(user, loadAssessmentWorkspace, 'Unable to load assessment workspace.');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [rubric, setRubric] = useState<Rubric | null>(null);
  const lock = useRef(false);
  const scope = useRef(user?.id);
  scope.current = user?.id;
  useEffect(() => {
    lock.current = false;
    setBusy(false);
    setError('');
    setSuccess('');
    setRubric(null);
    const actor = user?.id;
    void loadActiveRubric()
      .then((value) => {
        if (scope.current === actor) setRubric(value);
      })
      .catch((cause) => {
        if (scope.current === actor)
          setError(cause instanceof Error ? cause.message : 'Unable to load the active rubric.');
      });
  }, [user?.id]);
  async function run(name: string, args: Record<string, unknown>) {
    if (!user || lock.current) return;
    const actor = user.id;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await state.mutate(() => updateAssessment(user, name, args));
      if (scope.current === actor) setSuccess('Update saved.');
    } catch (e) {
      if (scope.current === actor) setError(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      if (scope.current === actor) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function form(
    event: FormEvent<HTMLFormElement>,
    name: string,
    build: (f: FormData) => Record<string, unknown>,
  ) {
    event.preventDefault();
    try {
      void run(name, build(new FormData(event.currentTarget)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the form values.');
    }
  }
  if (!user) return null;
  const w = state.workspace;
  const role = user.role;
  return (
    <div className="assessment-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ASSESSMENT & RESULTS</span>
          <h1>
            {role === 'student'
              ? 'My results'
              : role === 'examiner'
                ? 'Assigned defenses'
                : role === 'supervisor'
                  ? 'Supervisor marks'
                  : 'Assessment management'}
          </h1>
          <p>
            Group components contribute 55 marks; individual contribution, viva and peer review
            contribute 45.
          </p>
          {rubric && (
            <p>
              Active rubric: <strong>{rubric.name}</strong> · version {rubric.version}. Criterion
              scores are validated and retained with each new assessment.
            </p>
          )}
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void state.refresh()}>
          Refresh
        </Button>
      </div>
      {(error || state.error) && <ErrorMessage message={error || state.error} />}{' '}
      {success && (
        <p role="status" className="assessment-success">
          {success}
        </p>
      )}
      {state.loading ? (
        <LoadingState />
      ) : (
        w && (
          <>
            {role === 'supervisor' &&
              w.projects.map((p) => (
                <Card key={p.id} title={p.title}>
                  <form
                    onSubmit={(e) =>
                      form(
                        e,
                        rubric
                          ? 'fyp_governance_save_supervisor_marks'
                          : 'fyp_v2_save_supervisor_marks',
                        (f) =>
                          rubric
                            ? {
                                p_project_id: p.id,
                                p_scores: {
                                  proposal: rubricScores(f, rubric, 'proposal'),
                                  progress: rubricScores(f, rubric, 'progress'),
                                  contribution: Object.fromEntries(
                                    p.members.map((m) => [
                                      m.id,
                                      rubricScores(f, rubric, 'contribution', `${m.id}:`),
                                    ]),
                                  ),
                                },
                              }
                            : {
                                p_project_id: p.id,
                                p_proposal: Number(f.get('proposal')),
                                p_progress: Number(f.get('progress')),
                                p_individual: p.members.map((m) => ({
                                  student_id: m.id,
                                  mark: Number(f.get(m.id)),
                                })),
                              },
                      )
                    }
                  >
                    <div className="assessment-fields">
                      {rubric ? (
                        <>
                          <RubricFields rubric={rubric} component="proposal" />
                          <RubricFields rubric={rubric} component="progress" />
                          {p.members.map((m) => (
                            <fieldset className="assessment-rubric-group" key={m.id}>
                              <legend>{m.full_name}: individual contribution</legend>
                              <RubricFields
                                rubric={rubric}
                                component="contribution"
                                prefix={`${m.id}:`}
                              />
                            </fieldset>
                          ))}
                        </>
                      ) : (
                        <>
                          <Field
                            name="proposal"
                            label="Proposal / 10"
                            max={10}
                            value={p.supervisor_marks?.proposal}
                          />
                          <Field
                            name="progress"
                            label="Progress & documentation / 15"
                            max={15}
                            value={p.supervisor_marks?.progress}
                          />
                          {p.members.map((m) => (
                            <Field
                              key={m.id}
                              name={m.id}
                              label={m.full_name + ': individual contribution / 15'}
                              max={15}
                              value={
                                p.supervisor_marks?.individual.find((x) => x.student_id === m.id)
                                  ?.mark
                              }
                            />
                          ))}
                        </>
                      )}
                    </div>
                    <Button disabled={busy} type="submit">
                      Save supervisor marks
                    </Button>
                  </form>
                  <p>Defense readiness requires every mandatory milestone to be accepted.</p>
                  <Button
                    variant="secondary"
                    disabled={
                      busy ||
                      !p.milestones?.length ||
                      p.milestones.some((m) => m.status !== 'accepted')
                    }
                    onClick={() => void run('fyp_v2_certify_defense', { p_project_id: p.id })}
                  >
                    Certify defense readiness
                  </Button>
                  {p.certified && <p>Last certified: {new Date(p.certified).toLocaleString()}</p>}
                </Card>
              ))}
            {role === 'coordinator' &&
              w.projects.map((p) => (
                <Card key={p.id} title={p.title}>
                  {p.peer_marks?.map((mark) => (
                    <div className="assessment-peer-review" key={mark.student_id}>
                      <h3>
                        {p.members.find((m) => m.id === mark.student_id)?.full_name ||
                          mark.student_id}
                      </h3>
                      <p>
                        Original peer mark: {mark.original_mark ?? 'Missing'} / 10 · Current:{' '}
                        {mark.mark ?? 'Missing'} / 10
                      </p>
                      <StatusBadge tone={mark.status === 'pending_review' ? 'amber' : 'green'}>
                        {mark.status.replaceAll('_', ' ')}
                      </StatusBadge>
                      <p>{mark.flags.map((x) => x.replaceAll('_', ' ')).join(' · ')}</p>
                      <form
                        onSubmit={(e) =>
                          form(e, 'fyp_v2_review_peer_mark', (f) => ({
                            p_project_id: p.id,
                            p_student_id: mark.student_id,
                            p_signature: mark.signature,
                            p_method: String(f.get('method')),
                            p_mark: f.get('mark') === '' ? null : Number(f.get('mark')),
                            p_exclude_evaluator: f.get('exclude') || null,
                            p_reason: String(f.get('reason')),
                          }))
                        }
                      >
                        <div className="assessment-fields">
                          <label>
                            Review decision
                            <select name="method" defaultValue="confirm">
                              <option value="confirm">Confirm calculated mark</option>
                              <option value="exclude">Exclude an invalid rating</option>
                              <option value="assign">Assign a reviewed mark</option>
                            </select>
                          </label>
                          <label>
                            Reviewed mark / 10 (for assignment)
                            <input name="mark" type="number" min="0" max="10" step="0.01" />
                          </label>
                          <label>
                            Rating to exclude
                            <select name="exclude" defaultValue="">
                              <option value="">Choose evaluator</option>
                              {mark.ratings.map((r) => (
                                <option key={r.evaluator} value={r.evaluator}>
                                  {p.members.find((m) => m.id === r.evaluator)?.full_name ||
                                    r.evaluator}
                                  : {r.rating}/5{r.excluded ? ' (excluded)' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Review reason
                            <textarea name="reason" required maxLength={4000} />
                          </label>
                        </div>
                        <Button disabled={busy} type="submit">
                          Save reasoned review
                        </Button>
                      </form>
                    </div>
                  ))}
                  <h3>Schedule final defense</h3>
                  <p>Certification from the assigned supervisor must be less than 24 hours old.</p>
                  <form
                    onSubmit={(e) =>
                      form(e, 'fyp_v2_schedule_defense', (f) => ({
                        p_project_id: p.id,
                        p_scheduled_at: new Date(String(f.get('date'))).toISOString(),
                        p_location: String(f.get('location')),
                        p_fee_paid: f.get('fee') === 'on',
                        p_examiner_one: String(f.get('examiner_one')),
                        p_examiner_two: String(f.get('examiner_two')),
                      }))
                    }
                  >
                    <div className="assessment-fields">
                      <label>
                        Defense date
                        <input name="date" type="datetime-local" required />
                      </label>
                      <label>
                        Location
                        <input name="location" required maxLength={200} />
                      </label>
                      {['examiner_one', 'examiner_two'].map((name, i) => (
                        <label key={name}>
                          Examiner {i + 1}
                          <select name={name} required defaultValue="">
                            <option value="" disabled>
                              Choose examiner
                            </option>
                            {w.examiners.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.full_name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                      <label className="assessment-checkbox">
                        <input name="fee" type="checkbox" required />
                        Fee Paid
                      </label>
                    </div>
                    <Button
                      type="submit"
                      disabled={
                        busy || !p.certified || w.defenses.some((d) => d.project_id === p.id)
                      }
                    >
                      Schedule defense
                    </Button>
                  </form>
                </Card>
              ))}
            {w.defenses.map((d) => (
              <Card key={d.id} title={d.title}>
                <p>
                  {new Date(d.scheduled_at).toLocaleString()} · {d.location}
                </p>
                <StatusBadge tone="green">Fee paid</StatusBadge>
                {role === 'examiner' ? (
                  d.my_assessment ? (
                    <>
                      <p>Your assessment is submitted and locked.</p>
                      <p>
                        Report {d.my_assessment.report}/15 · Implementation{' '}
                        {d.my_assessment.implementation}/15
                      </p>
                      {d.members.map((m) => (
                        <p key={m.id}>
                          {m.full_name}: Viva{' '}
                          {d.my_assessment?.viva.find((v) => v.student_id === m.id)?.mark}/20
                        </p>
                      ))}
                    </>
                  ) : (
                    <form
                      onSubmit={(e) =>
                        form(
                          e,
                          rubric
                            ? 'fyp_governance_submit_examiner_marks'
                            : 'fyp_v2_submit_examiner_marks',
                          (f) =>
                            rubric
                              ? {
                                  p_defense_id: d.id,
                                  p_scores: {
                                    report: rubricScores(f, rubric, 'report'),
                                    implementation: rubricScores(f, rubric, 'implementation'),
                                    viva: Object.fromEntries(
                                      d.members.map((m) => [
                                        m.id,
                                        rubricScores(f, rubric, 'viva', `${m.id}:`),
                                      ]),
                                    ),
                                  },
                                  p_comments: String(f.get('comments')),
                                }
                              : {
                                  p_defense_id: d.id,
                                  p_report: Number(f.get('report')),
                                  p_implementation: Number(f.get('implementation')),
                                  p_viva: d.members.map((m) => ({
                                    student_id: m.id,
                                    mark: Number(f.get(m.id)),
                                  })),
                                  p_comments: String(f.get('comments')),
                                },
                        )
                      }
                    >
                      <div className="assessment-fields">
                        {rubric ? (
                          <>
                            <RubricFields rubric={rubric} component="report" />
                            <RubricFields rubric={rubric} component="implementation" />
                            {d.members.map((m) => (
                              <fieldset className="assessment-rubric-group" key={m.id}>
                                <legend>{m.full_name}: viva</legend>
                                <RubricFields
                                  rubric={rubric}
                                  component="viva"
                                  prefix={`${m.id}:`}
                                />
                              </fieldset>
                            ))}
                          </>
                        ) : (
                          <>
                            <Field name="report" label="Final report / 15" max={15} />
                            <Field
                              name="implementation"
                              label="Implementation & demonstration / 15"
                              max={15}
                            />
                            {d.members.map((m) => (
                              <Field
                                key={m.id}
                                name={m.id}
                                label={m.full_name + ': viva / 20'}
                                max={20}
                              />
                            ))}
                          </>
                        )}
                        <label>
                          Assessment comments
                          <textarea name="comments" required maxLength={4000} />
                        </label>
                      </div>
                      <p>Submission is final. Check each component before submitting.</p>
                      <Button type="submit" disabled={busy}>
                        Finalize my assessment
                      </Button>
                    </form>
                  )
                ) : role === 'coordinator' ? (
                  <>
                    <p>{d.submitted_examiners.length}/2 examiner assessments submitted.</p>
                    <div className="assessment-actions">
                      <Button
                        disabled={busy || w.results.some((r) => r.defense_id === d.id)}
                        onClick={() => void run('fyp_v2_finalize_results', { p_defense_id: d.id })}
                      >
                        Verify and calculate results
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={
                          busy ||
                          !w.results.some((r) => r.defense_id === d.id) ||
                          w.results.filter((r) => r.defense_id === d.id).every((r) => r.released_at)
                        }
                        onClick={() => void run('fyp_v2_release_results', { p_defense_id: d.id })}
                      >
                        Release verified results
                      </Button>
                    </div>
                  </>
                ) : null}
              </Card>
            ))}
            {w.results.map((r) => (
              <Card
                key={r.id + ':' + r.version}
                title={role === 'student' ? 'Released result' : 'Result: ' + r.student_id}
              >
                <StatusBadge tone={r.released_at ? 'green' : 'amber'}>
                  {r.released_at ? 'Released' : 'Verified, not released'}
                </StatusBadge>
                <div className="assessment-result">
                  <div>
                    Group component<strong>{r.group_mark} / 55</strong>
                  </div>
                  <div>
                    Individual component<strong>{r.individual_mark} / 45</strong>
                  </div>
                  <div>
                    Final result<strong>{r.total} / 100</strong>
                  </div>
                </div>
                <p>
                  Proposal {r.group_components.proposal}/10 · Progress {r.group_components.progress}
                  /15 · Report {r.group_components.report}/15 · Implementation{' '}
                  {r.group_components.implementation}/15
                </p>
                <p>
                  Contribution {r.individual_components.contribution}/15 · Viva{' '}
                  {r.individual_components.viva}/20 · Peer mark {r.individual_components.peer}/10
                </p>
                {role === 'coordinator' && r.released_at && (
                  <details>
                    <summary>Correct released components with an audit reason</summary>
                    <p>Changing group components updates every student in this defense.</p>
                    <form
                      onSubmit={(e) =>
                        form(e, 'fyp_v2_correct_result', (f) => ({
                          p_result_id: r.id,
                          p_expected_version: r.version,
                          p_group_components: {
                            proposal: Number(f.get('proposal')),
                            progress: Number(f.get('progress')),
                            report: Number(f.get('report')),
                            implementation: Number(f.get('implementation')),
                          },
                          p_individual_components: {
                            contribution: Number(f.get('contribution')),
                            viva: Number(f.get('viva')),
                            peer: Number(f.get('peer')),
                          },
                          p_reason: String(f.get('reason')),
                        }))
                      }
                    >
                      <div className="assessment-fields">
                        {Object.entries(r.group_components).map(([name, value]) => (
                          <Field
                            key={name}
                            name={name}
                            label={name + ' / ' + (name === 'proposal' ? 10 : 15)}
                            max={name === 'proposal' ? 10 : 15}
                            value={value}
                          />
                        ))}
                        {Object.entries(r.individual_components).map(([name, value]) => (
                          <Field
                            key={name}
                            name={name}
                            label={
                              name +
                              ' / ' +
                              (name === 'contribution' ? 15 : name === 'viva' ? 20 : 10)
                            }
                            max={name === 'contribution' ? 15 : name === 'viva' ? 20 : 10}
                            value={value}
                          />
                        ))}
                        <label>
                          Correction reason
                          <textarea name="reason" required maxLength={4000} />
                        </label>
                      </div>
                      <Button type="submit" disabled={busy}>
                        Save audited correction
                      </Button>
                    </form>
                  </details>
                )}
              </Card>
            ))}
            {!w.projects.length && !w.defenses.length && !w.results.length && (
              <EmptyState
                title={role === 'student' ? 'No released results yet' : 'No assessment records yet'}
                description={
                  role === 'student'
                    ? 'Your coordinator must verify and release your result before it appears here.'
                    : 'The assigned supervisor must refresh approved project evidence and certify defense readiness first.'
                }
              />
            )}
          </>
        )
      )}
    </div>
  );
}

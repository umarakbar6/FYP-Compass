import { createLocalServer } from './local-server.mjs';
import { createClient } from '@supabase/supabase-js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
let server, clients;
before(async () => {
  server = await createLocalServer({ port: 0, memory: true });
  clients = {};
  for (const p of server.people) {
    const response = await fetch(server.url + '/local-demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id }),
    });
    const session = await response.json();
    const client = createClient(server.url, 'local-demo-public-client', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await client.auth.setSession(session);
    assert.equal(signed.error, null);
    clients[p.full_name] = client;
  }
});
after(async () => {
  for (const c of Object.values(clients || {})) c.auth.stopAutoRefresh();
  await server?.close();
});
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.equal(result.error, null, result.error?.message);
  return result.data;
}
test('actual Supabase SDK sign-in, profile access and role-scoped RPCs work through the local HTTP bridge', async () => {
  const student = clients['Student One'],
    coord = clients['Demo Coordinator'];
  const profile = await student.from('fyp_profiles').select('id,full_name,role').single();
  assert.equal(profile.error, null);
  assert.equal(profile.data.role, 'student');
  const other = await student
    .from('fyp_profiles')
    .select('id,full_name,role')
    .eq('id', server.people.find((p) => p.role === 'coordinator').id)
    .single();
  assert(other.error);
  const ws = await rpc(student, 'fyp_v2_core_get_student_workspace');
  assert.equal(ws.supervisors.length, 3);
  const denied = await student.rpc('fyp_v2_core_report');
  assert.equal(denied.error.code, '42501');
  const report = await rpc(coord, 'fyp_v2_core_accreditation');
  assert.equal(report.groups.length, 0);
  assert.equal(report.participants.length, 6);
});
test('shared group/proposal/matching/approval, binary upload and signed download work with the same SDK as the frontend', async () => {
  const student = clients['Student One'],
    coord = clients['Demo Coordinator'];
  const workspace = await rpc(student, 'fyp_v2_core_get_student_workspace');
  let w = await rpc(student, 'fyp_v2_core_create_student_group', {
    p_name: 'HTTP Team',
    p_session_id: workspace.session.id,
    p_member_ids: server.people
      .filter((p) => p.role === 'student' && p.full_name !== 'Student One')
      .map((p) => p.id),
  });
  w = await rpc(student, 'fyp_v2_core_save_student_proposal', {
    p_group_id: w.group.id,
    p_title: 'Academic supervision portal',
    p_abstract: 'Manage group proposals and assessments',
    p_keywords: ['academic'],
    p_topic_ids: workspace.topics.map((t) => t.id),
    p_supervisor_ids: workspace.supervisors.map((s) => s.id),
    p_document: null,
    p_submit: true,
  });
  await rpc(coord, 'fyp_v2_core_match', { p_seed: 'sdk-seed' });
  const allocated = await rpc(student, 'fyp_v2_core_get_student_workspace');
  const supervisorName = server.people.find(
    (p) => p.id === allocated.allocation.supervisor_id,
  ).full_name;
  const supervisor = clients[supervisorName];
  await rpc(supervisor, 'fyp_v2_core_run_similarity_screen', { p_proposal_id: w.proposal.id });
  await rpc(supervisor, 'fyp_v2_core_review_supervisor_proposal', {
    p_proposal_id: w.proposal.id,
    p_action: 'approve',
    p_comment: '',
    p_justification: '',
    p_expected_status: 'submitted',
  });
  const ms = await rpc(student, 'fyp_v2_core_get_milestone_workspace');
  const m = ms.projects[0].milestones[0];
  const studentId = server.people.find((p) => p.full_name === 'Student One').id;
  const file = studentId + '/' + allocated.group.id + '/' + m.id + '/evidence.pdf';
  const bytes = new TextEncoder().encode('%PDF-1.4\nlocal test evidence');
  const upload = await student.storage
    .from('fyp-v2-submissions')
    .upload(file, new Blob([bytes], { type: 'application/pdf' }));
  assert.equal(upload.error, null, upload.error?.message);
  await rpc(student, 'fyp_v2_core_submit_student_milestone', {
    p_milestone_id: m.id,
    p_document: { name: 'evidence.pdf', path: file, size: bytes.length },
    p_statement: 'Implemented the portal.',
    p_expected_submission_id: null,
  });
  const signed = await supervisor.storage.from('fyp-v2-submissions').createSignedUrl(file, 60);
  assert.equal(signed.error, null, signed.error?.message);
  const downloaded = await fetch(signed.data.signedUrl);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
  const invalid = await fetch(signed.data.signedUrl.replace(/token=.*/, 'token=invalid'));
  assert.equal(invalid.status, 401);
  const health = await rpc(supervisor, 'get_health_workspace');
  assert.equal(health.projects[0].health.level, 'amber');
  const draft = await rpc(supervisor, 'create_group_health_fallback', {
    p_project_id: allocated.group.id,
  });
  assert.equal(draft.reports[0].source, 'fallback');
  assert.equal(draft.notices.length, 0);
});
test('invalid JWTs, disallowed browser origins and oversized bodies are rejected', async () => {
  const anonymous = await fetch(server.url + '/rest/v1/rpc/fyp_v2_core_report', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(anonymous.status, 401);
  const wrongOrigin = await fetch(server.url + '/local-demo/accounts', {
    headers: { Origin: 'https://unrelated.example' },
  });
  assert.equal(wrongOrigin.status, 403);
  const large = await fetch(server.url + '/local-demo/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(17000),
  });
  assert.equal(large.status, 413);
});

test('browser Auth SDK preflight permits its version header only for the configured loopback origin', async () => {
  const requested = [
    'authorization',
    'apikey',
    'content-type',
    'x-client-info',
    'x-supabase-api-version',
    'accept-profile',
    'content-profile',
    'prefer',
  ];
  const response = await fetch(server.url + '/auth/v1/user', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5182',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': requested.join(','),
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5182');
  const allowed = response.headers
    .get('access-control-allow-headers')
    .toLowerCase()
    .split(',')
    .map((x) => x.trim());
  assert(requested.every((x) => allowed.includes(x)));
  const denied = await fetch(server.url + '/auth/v1/user', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://unrelated.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': requested.join(','),
    },
  });
  assert.equal(denied.status, 403);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { emailSessionAllowed, parseEmailRequest } from './request.mjs';
import { dispatchEmail } from './dispatch.mjs';
const id = '00000000-0000-4000-8000-000000000001';
test('email request rejects arbitrary recipients, missing consent, arrays and malformed IDs', () => {
  for (const v of [
    null,
    [],
    { type: 'delivery_test', confirm: false, request_id: id },
    { type: 'delivery_test', confirm: true, request_id: id, to: 'other@example.test' },
    { type: 'reminder', confirm: true, run_id: '----', reminder_id: id },
  ])
    assert.throws(() => parseEmailRequest(v));
  assert.equal(
    parseEmailRequest({ type: 'delivery_test', confirm: true, request_id: id }).request_id,
    id,
  );
});
function fixture({
  diagnostic = false,
  claim = true,
  status = 'reserved',
  failure = false,
  finishError = false,
  prepareError = false,
} = {}) {
  let sends = 0;
  const calls = [];
  const admin = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'fyp_email_test_prepare')
        return prepareError
          ? { error: { code: '42501' } }
          : { data: { id, status, claimed: claim } };
      if (name === 'fyp_reminder_smtp_claim') return { data: claim };
      return finishError ? { error: { code: 'FAIL' } } : { data: null };
    },
  };
  const client = {
    rpc: async () =>
      prepareError
        ? { error: { code: '42501' } }
        : {
            data: {
              id,
              status,
              name: 'Milestone',
              group_name: 'Group',
              deadline: '2026-10-13',
              text: 'Review the current evidence.',
            },
          },
  };
  const send = async (message) => {
    sends++;
    assert.equal(message.to, 'owner@example.test');
    assert.equal(message.messageId, '<' + id + '@fyp-compass-ten.vercel.app>');
    if (failure) throw Error('Private provider error');
  };
  return {
    args: {
      body: diagnostic
        ? { type: 'delivery_test', request_id: id, confirm: true }
        : { type: 'reminder', run_id: id, reminder_id: id, confirm: true },
      user: { id, email: 'owner@example.test' },
      admin,
      client,
      send,
    },
    sends: () => sends,
    calls,
  };
}
test('eligible reminder sends only to verified server identity and records receipt', async () => {
  const f = fixture();
  const r = await dispatchEmail(f.args);
  assert.equal(r.status, 200);
  assert.equal(f.sends(), 1);
  assert(
    f.calls.some((c) => c.name === 'fyp_reminder_delivery_finish' && c.args.p_status === 'sent'),
  );
});
test('completed delivery is returned without resending', async () => {
  const f = fixture({ status: 'sent' });
  assert.equal((await dispatchEmail(f.args)).status, 200);
  assert.equal(f.sends(), 0);
});
test('processing or failed SMTP claim never automatically resends', async () => {
  for (const diagnostic of [true, false]) {
    const f = fixture({ diagnostic, claim: false });
    assert.equal((await dispatchEmail(f.args)).status, 409);
    assert.equal(f.sends(), 0);
  }
});
test('SMTP failure consumes attempt and records failed receipt without leaking provider error', async () => {
  const f = fixture({ failure: true });
  const r = await dispatchEmail(f.args);
  assert.equal(r.status, 503);
  assert.equal(f.sends(), 1);
  assert(!JSON.stringify(r).includes('Private provider'));
  assert(f.calls.some((c) => c.args.p_status === 'failed'));
});
test('accepted message with lost database receipt does not trigger a second send', async () => {
  const f = fixture({ finishError: true });
  assert.equal((await dispatchEmail(f.args)).status, 503);
  assert.equal(f.sends(), 1);
});
test('diagnostic and reminder authorization failures never reach SMTP', async () => {
  for (const diagnostic of [true, false]) {
    const f = fixture({ diagnostic, prepareError: true });
    assert.equal((await dispatchEmail(f.args)).status, 403);
    assert.equal(f.sends(), 0);
  }
});
test('coordinator diagnostic sends a fixed body with no project evidence', async () => {
  const f = fixture({ diagnostic: true });
  f.args.send = async (m) => {
    assert(m.text.includes('No project records or passwords'));
    assert(!m.text.includes('Review the current evidence'));
  };
  assert.equal((await dispatchEmail(f.args)).status, 200);
});

test('email transport requires a server-verified actor and satisfied MFA before service-role delivery', async () => {
  for (const value of [
    null,
    { actor_id: 'another', mfa_required: false },
    { actor_id: id, mfa_required: true },
    { actor_id: id, mfa_required: 'false' },
  ]) {
    assert.equal(
      await emailSessionAllowed({ rpc: async () => ({ data: value, error: null }) }, id),
      false,
    );
  }
  assert.equal(
    await emailSessionAllowed(
      { rpc: async () => ({ data: { actor_id: id, mfa_required: false }, error: null }) },
      id,
    ),
    true,
  );
  assert.equal(
    await emailSessionAllowed(
      {
        rpc: async () => {
          throw Error('Offline');
        },
      },
      id,
    ),
    false,
  );
});

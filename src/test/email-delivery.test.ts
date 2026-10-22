import { deliverEmail } from '../operations/email-delivery';
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth } }));
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id }, access_token: 'synthetic-test-token' } },
    error: null,
  });
});
afterEach(() => vi.unstubAllGlobals());
it('binds the email request to the verified current actor token and the same-origin API', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'sent', reference: id }),
    });
  vi.stubGlobal('fetch', request);
  await expect(
    deliverEmail({ type: 'delivery_test', confirm: true, request_id: id }, id),
  ).resolves.toBe(id);
  expect(request).toHaveBeenCalledWith(
    '/api/reminder-email',
    expect.objectContaining({
      headers: { 'content-type': 'application/json', Authorization: 'Bearer synthetic-test-token' },
    }),
  );
});
it('never sends when the current actor differs from the approving account', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  await expect(deliverEmail({}, 'another-actor')).rejects.toThrow('session changed');
  expect(request).not.toHaveBeenCalled();
});
it('never sends after the session expires', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  await expect(deliverEmail({}, id)).rejects.toThrow('session changed');
  expect(request).not.toHaveBeenCalled();
});
it.each([
  [409, 'reconciliation'],
  [429, 'daily email limit'],
])('explains HTTP %s without retrying or resending', async (status, text) => {
  const request = vi.fn().mockResolvedValue({ status });
  vi.stubGlobal('fetch', request);
  await expect(deliverEmail({}, id)).rejects.toThrow(text);
  expect(request).toHaveBeenCalledOnce();
});
it('rejects a malformed receipt rather than displaying delivery success', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'sent', reference: 'invalid' }),
      }),
  );
  await expect(deliverEmail({}, id)).rejects.toThrow('could not be confirmed');
});

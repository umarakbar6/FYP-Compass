import { updatePasswordForSession } from '../auth/recovery';
it('a password update remains bound to its verified original account token', async () => {
  let actor: string | null = 'one';
  const auth = {
    getSession: async () => ({
      data: { session: { access_token: 'original-test-token', user: { id: 'one' } } },
      error: null,
    }),
    getUser: async () => ({ data: { user: { id: 'one' } }, error: null }),
  };
  const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
    actor = 'two';
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer original-test-token',
    );
    return new Response('{}');
  });
  await updatePasswordForSession(
    auth,
    {
      url: 'https://owned.example.test',
      key: 'public-test-key',
      password: 'test-only-password',
      expectedActor: 'one',
      currentActor: () => actor,
    },
    send as typeof fetch,
  );
  expect(send).toHaveBeenCalledOnce();
});
it('a switched or invalid account cannot dispatch the old password submission', async () => {
  let actor: string | null = 'one';
  const send = vi.fn();
  const auth = {
    getSession: async () => ({
      data: { session: { access_token: 'fixture', user: { id: 'one' } } },
      error: null,
    }),
    getUser: async () => {
      actor = 'two';
      return { data: { user: { id: 'two' } }, error: null };
    },
  };
  await expect(
    updatePasswordForSession(
      auth,
      {
        url: 'https://owned.example.test',
        key: 'public',
        password: 'fixture-password',
        expectedActor: 'one',
        currentActor: () => actor,
      },
      send,
    ),
  ).rejects.toThrow('session changed');
  expect(send).not.toHaveBeenCalled();
});

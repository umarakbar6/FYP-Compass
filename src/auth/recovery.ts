interface RecoveryAuth {
  getSession: () => Promise<{
    data: { session: { access_token: string; user: { id: string } } | null };
    error: unknown;
  }>;
  getUser: (jwt?: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
}
export async function updatePasswordForSession(
  auth: RecoveryAuth,
  config: {
    url: string;
    key: string;
    password: string;
    expectedActor: string;
    currentActor: () => string | null;
  },
  requestFetch: typeof fetch = fetch,
) {
  const { data, error } = await auth.getSession(),
    session = data.session;
  if (
    error ||
    !session ||
    session.user.id !== config.expectedActor ||
    config.currentActor() !== config.expectedActor
  )
    throw Error('Your recovery session changed. Open a fresh recovery link.');
  const verified = await auth.getUser(session.access_token);
  if (
    verified.error ||
    verified.data.user?.id !== config.expectedActor ||
    config.currentActor() !== config.expectedActor
  )
    throw Error('Your recovery session changed. Open a fresh recovery link.');
  // The authenticated request is bound to this verified token, even if another account signs in while the request is pending.
  const result = await requestFetch(new URL('/auth/v1/user', config.url), {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      apikey: config.key,
      Authorization: 'Bearer ' + session.access_token,
    },
    body: JSON.stringify({ password: config.password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok)
    throw Error(
      'Your password could not be saved. Request a fresh recovery link or contact the coordinator.',
    );
}

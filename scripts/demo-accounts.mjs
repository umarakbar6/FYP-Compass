import { randomBytes, randomUUID } from 'node:crypto';
export const projectRef = 'mqzsrphoagzfmdovmukg';
const specifications = [
  ['student', 'Student One'],
  ['student', 'Student Two'],
  ['student', 'Student Three'],
  ['supervisor', 'Demo Supervisor'],
  ['examiner', 'Examiner One'],
  ['examiner', 'Examiner Two'],
  ['coordinator', 'Demo Coordinator'],
  ['supervisor', 'Demo Supervisor Two'],
  ['supervisor', 'Demo Supervisor Three'],
];
export function newPlan() {
  const run = randomUUID();
  return {
    version: 1,
    projectRef,
    run,
    status: 'unprovisioned',
    accounts: specifications.map(([role, name], i) => ({
      role,
      full_name: name,
      email: `fyp-${role}-${i + 1}-${run.slice(0, 8)}@demo.fypcompass.test`,
      password: randomBytes(24).toString('base64url') + '!aA1',
      status: 'unprovisioned',
    })),
  };
}
export function validatePlan(plan) {
  if (
    plan?.version !== 1 ||
    plan.projectRef !== projectRef ||
    !/^[-a-f0-9]{36}$/.test(plan.run) ||
    !Array.isArray(plan.accounts) ||
    plan.accounts.length !== 9
  )
    throw new Error('Invalid private demo plan.');
  const emails = new Set();
  plan.accounts.forEach((a, i) => {
    if (
      a.role !== specifications[i][0] ||
      a.full_name !== specifications[i][1] ||
      a.email !== `fyp-${a.role}-${i + 1}-${plan.run.slice(0, 8)}@demo.fypcompass.test` ||
      typeof a.password !== 'string' ||
      a.password.length < 32 ||
      emails.has(a.email)
    )
      throw new Error('Invalid private demo account.');
    emails.add(a.email);
  });
  return plan;
}
export function validateAdmin(url, key) {
  if (url !== `https://${projectRef}.supabase.co`)
    throw new Error('Refusing to change a different Supabase project.');
  if (typeof key !== 'string' || !key)
    throw new Error('Server administrator key is missing. No live accounts have been created.');
  if (key.startsWith('sb_secret_')) return;
  try {
    const claim = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (claim.role === 'service_role' && claim.ref === projectRef) return;
  } catch {}
  throw new Error(
    'A public browser key cannot create accounts. Supply a server administrator key.',
  );
}
export function validatePublic(key) {
  if (typeof key === 'string' && key.startsWith('sb_publishable_')) return;
  try {
    const claim = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (claim.role === 'anon' && claim.ref === projectRef) return;
  } catch {}
  throw new Error(
    'Login verification requires a public key for the FYP project; server secrets are forbidden.',
  );
}
export async function provision(plan, api, persist) {
  validatePlan(plan);
  // Complete collision scan before the first write. Existing unrelated accounts are never reset.
  const users = await api.list();
  for (const a of plan.accounts) {
    const existing = users.find((u) => u.email?.toLowerCase() === a.email);
    if (
      existing &&
      (existing.app_metadata?.fyp_demo_run !== plan.run ||
        existing.app_metadata?.fyp_demo_role !== a.role ||
        (a.id && a.id !== existing.id))
    )
      throw new Error('Account collision: no existing account was changed.');
  }
  plan.status = 'provisioning';
  await persist(plan);
  for (const a of plan.accounts) {
    let user = users.find((u) => u.email?.toLowerCase() === a.email);
    if (!user)
      user = await api.create({
        email: a.email,
        password: a.password,
        email_confirm: true,
        app_metadata: { fyp_demo_run: plan.run, fyp_demo_role: a.role },
        user_metadata: { full_name: a.full_name },
      });
    if (!user?.id) throw new Error('Account creation did not return an ID.');
    a.id = user.id;
    a.status = 'auth-created';
    await persist(plan);
    await api.profile({ id: a.id, full_name: a.full_name, role: a.role });
    a.status = 'profile-created';
    await persist(plan);
    const actual = await api.verify(a);
    if (actual.id !== a.id || actual.role !== a.role || actual.full_name !== a.full_name)
      throw new Error('Signed-in profile verification failed.');
    a.status = 'login-verified';
    await persist(plan);
  }
  plan.status = 'login-verified';
  await persist(plan);
  return plan;
}

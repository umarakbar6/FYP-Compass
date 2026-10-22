import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  newPlan,
  validatePlan,
  validateAdmin,
  validatePublic,
  provision,
  projectRef,
} from './demo-accounts.mjs';
const folder = path.resolve('.private');
const file = path.join(folder, 'demo-accounts-' + projectRef + '.json');
function persist(plan) {
  fs.mkdirSync(folder, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
async function main() {
  const mode = process.argv[2];
  if (!['--prepare', '--provision'].includes(mode))
    throw new Error('Use --prepare or --provision.');
  const plan = fs.existsSync(file)
    ? validatePlan(JSON.parse(fs.readFileSync(file, 'utf8')))
    : newPlan();
  if (mode === '--prepare') {
    persist(plan);
    console.log(
      'Nine private demo identities prepared; no remote accounts created. State: ' + plan.status,
    );
    return;
  }
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  validateAdmin(url, secret);
  const publicKey = process.env.SUPABASE_ANON_KEY;
  validatePublic(publicKey);
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const check = (result, message) => {
    if (result.error) throw new Error(message);
    return result.data;
  };
  await provision(
    plan,
    {
      list: async () => {
        const users = [];
        for (let page = 1; page <= 1000; page++) {
          const data = check(
            await admin.auth.admin.listUsers({ page, perPage: 100 }),
            'Cannot inspect account collisions.',
          );
          users.push(...data.users);
          if (data.users.length < 100) return users;
        }
        throw new Error('Account inventory exceeds the safe scan limit.');
      },
      create: async (input) =>
        check(await admin.auth.admin.createUser(input), 'Could not create demo account.').user,
      profile: async (input) => {
        check(
          await admin.from('fyp_profiles').upsert(input, { onConflict: 'id' }),
          'Role profile contract is incompatible; no existing real account was changed.',
        );
      },
      verify: async (a) => {
        const client = createClient(url, publicKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        try {
          const signed = check(
            await client.auth.signInWithPassword({ email: a.email, password: a.password }),
            'Demo login could not be verified.',
          );
          if (signed.user?.id !== a.id) throw new Error('Demo identity mismatch.');
          return check(
            await client.from('fyp_profiles').select('id,full_name,role').eq('id', a.id).single(),
            'Signed-in profile is inaccessible.',
          );
        } finally {
          await client.auth.signOut();
        }
      },
    },
    persist,
  );
  console.log(
    'Nine demo logins and role profiles verified in the configured FYP project. Passwords remain in the project-specific .private account journal. Workflow acceptance is still required.',
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Account setup failed.');
  process.exitCode = 1;
});

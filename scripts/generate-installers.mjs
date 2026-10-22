import fs from 'node:fs';
import crypto from 'node:crypto';
const order = JSON.parse(fs.readFileSync('supabase/migration-order.json', 'utf8'));
const source = (name) => {
  const sql = fs.readFileSync('supabase/migrations/' + name, 'utf8');
  if (!sql.trim()) throw Error('Empty migration ' + name);
  return (
    '-- SOURCE: supabase/migrations/' + name + '\n' + sql.replace(/^(?:begin|commit);\s*$/gim, '')
  );
};
for (const [target, names] of [
  ['backend/INSTALL-PRODUCTION.sql', order],
  ['backend/INSTALL-ALL-V2.sql', order.slice(0, 8)],
]) {
  const out =
    '-- GENERATED from canonical supabase/migrations. Do not hand-edit.\n-- Fresh installation ONLY; never replay foundations on an existing live database.\nbegin;\n' +
    names.map(source).join('\n\n') +
    '\ncommit;\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== out)
      throw Error('Generated installer is stale: ' + target);
  } else fs.writeFileSync(target, out);
  console.log(
    target +
      ': ' +
      names.length +
      ' canonical migrations; SHA-256 ' +
      crypto.createHash('sha256').update(out).digest('hex'),
  );
}

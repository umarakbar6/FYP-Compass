import fs from 'node:fs';
import path from 'node:path';
export function checkBrowserOutput(folder = 'dist', environment = process.env) {
  const secrets = Object.entries(environment)
    .filter(
      ([name, value]) =>
        !name.startsWith('VITE_') &&
        /SECRET|TOKEN|PASSWORD|SERVICE_ROLE|GEMINI_API_KEY/.test(name) &&
        typeof value === 'string' &&
        value.length >= 12,
    )
    .map(([name, value]) => ({ name, value }));
  let checked = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Unexpected symlink in browser output.');
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!/\.(?:js|css|html|json|map|txt)$/i.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      checked++;
      if (
        /AIza[\w-]{30,}|sb_secret_[\w-]{10,}|sbp_[\w-]{30,}|-----BEGIN [\w ]*PRIVATE KEY/.test(text)
      )
        throw Error('Credential pattern in browser output: ' + file);
      for (const secret of secrets)
        if (text.includes(secret.value))
          throw Error('Server variable leaked to browser output: ' + secret.name);
      for (const jwt of text.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) || []) {
        let claims;
        try {
          claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        } catch {
          throw Error('Unexpected token in browser output: ' + file);
        }
        if (claims.role !== 'anon') throw Error('Non-public JWT in browser output: ' + file);
      }
    }
  }
  walk(folder);
  if (!checked) throw Error('Browser build output is missing.');
  return { checkedTextFiles: checked, noDetectedServerSecrets: true };
}

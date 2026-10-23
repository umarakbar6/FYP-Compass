import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const template = fs.readFileSync(new URL('../../supabase/templates/confirmation.html', import.meta.url), 'utf8');

test('confirmation email has an actionable Supabase link and the same visible fallback', () => {
  assert.match(template, /<a\b[^>]*href="\{\{ \.SiteURL \}\}\/auth\/confirm#confirmation_token=\{\{ \.TokenHash \}\}"[^>]*>Confirm email<\/a>/);
  assert.equal([...template.matchAll(/href="\{\{ \.SiteURL \}\}\/auth\/confirm#confirmation_token=\{\{ \.TokenHash \}\}"/g)].length, 2);
  assert.match(template, />\{\{ \.SiteURL \}\}\/auth\/confirm#confirmation_token=\{\{ \.TokenHash \}\}<\/a>/);
  assert.doesNotMatch(template, /<script\b|<button\b|<form\b|javascript:|onclick\s*=/i);
});
test('blocked-link fallback supplies a verification code and the first-party verification page', () => {
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.match(template, /href="\{\{ \.SiteURL \}\}\/auth\/confirm"/);
  assert.match(template, /expire shortly/);
  assert.match(template, /latest confirmation email/);
});
test('email logo stays first-party and has accessible text when images are blocked', () => {
  assert.match(template, /src="\{\{ \.SiteURL \}\}\/brand\/compass-email-v2.png"/);
  assert.match(template, /alt="FYP Compass logo"/);
  assert.match(template, /Privacy notice/);
  assert.match(template, /If you did not create an account/);
  assert.doesNotMatch(template, /src="https?:\/\//);
});

test('only the public email image allows cross-origin embedding', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const policy = route => config.headers.find(h => h.source === route).headers.find(h => h.key === 'Cross-Origin-Resource-Policy').value;
  assert.equal(policy('/(.*)'), 'same-origin');
  assert.equal(policy('/brand/compass-email-v2.png'), 'cross-origin');
  assert.match(template, /text-decoration:underline;color:#ffffff/);
});

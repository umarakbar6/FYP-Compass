import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const template = fs.readFileSync(new URL('../../supabase/templates/confirmation.html', import.meta.url), 'utf8');

test('confirmation email has an actionable Supabase link and the same visible fallback', () => {
  assert.match(template, /<a\b[^>]*href="\{\{ \.ConfirmationURL \}\}"[^>]*>Confirm email<\/a>/);
  assert.equal([...template.matchAll(/href="\{\{ \.ConfirmationURL \}\}"/g)].length, 2);
  assert.match(template, />\{\{ \.ConfirmationURL \}\}<\/a>/);
  assert.doesNotMatch(template, /<script\b|<button\b|<form\b|javascript:|onclick\s*=/i);
});
test('blocked-link fallback supplies a verification code and the first-party verification page', () => {
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.match(template, /href="\{\{ \.SiteURL \}\}\/auth\/confirm"/);
  assert.match(template, /expire shortly/);
  assert.match(template, /latest confirmation email/);
});
test('email logo stays first-party and has accessible text when images are blocked', () => {
  assert.match(template, /src="\{\{ \.SiteURL \}\}\/brand\/compass-email.png"/);
  assert.match(template, /alt="FYP Compass logo"/);
  assert.match(template, /Privacy notice/);
  assert.match(template, /If you did not create an account/);
  assert.doesNotMatch(template, /src="https?:\/\//);
});

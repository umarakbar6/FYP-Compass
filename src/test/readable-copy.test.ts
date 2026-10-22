import { describe, it, expect } from 'vitest';
import { readableCopy } from '../lib/readable-copy';
describe('Narrative display formatting', () => {
  it('removes compound and sentence dashes from prose', () => {
    expect(readableCopy('Role-based support — clear next steps.')).toBe(
      'Role based support clear next steps.',
    );
  });
  it('preserves URLs, email addresses, document names and canonical IDs', () => {
    const text =
      'https://example.test/my-project owner-name@example.test project-plan.pdf 9ed85bb9-6f61-4d57-8a59-618246125224';
    expect(readableCopy(text)).toBe(text);
  });
});

it('formats long plain prose and incomplete email-like text without runaway matching', () => {
  const plain = 'a'.repeat(50000);
  expect(readableCopy(plain + ' review-ready report')).toBe(plain + ' review ready report');
  expect(readableCopy(plain + '@invalid')).toBe(plain + '@invalid');
});
it('preserves protected tokens with punctuation while formatting surrounding prose', () => {
  expect(
    readableCopy(
      'Client-ready (https://example.test/my-project), owner-name@example.test and project-plan.pdf need follow-up.',
    ),
  ).toBe(
    'Client ready (https://example.test/my-project), owner-name@example.test and project-plan.pdf need follow up.',
  );
});

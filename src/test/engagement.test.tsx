import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GuidedDemo } from '../engagement/GuidedDemo';
import { createEnquiryHandler } from '../../backend/engagement/enquiry-handler';
const origin = 'https://fyp-compass-ten.vercel.app';
const input = {
  request_id: '00000000-0000-4000-8000-000000000001',
  name: 'Audit Client',
  email: 'client@example.test',
  brief: 'Build a verified academic portal.',
  plan: 'Regular',
  consent: true,
  website: '',
};
const req = (body: unknown = input, extra: RequestInit = {}) =>
  new Request(origin, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...extra,
  });
describe('Public enquiry endpoint', () => {
  it('confirms only a stored receipt and normalizes submitted contact data', async () => {
    const receive = vi.fn().mockResolvedValue({ reference: 'receipt-id', status: 'received' });
    const response = await createEnquiryHandler({
      origin,
      fingerprint: async () => 'a'.repeat(64),
      receive,
    })(req({ ...input, email: ' CLIENT@example.test ' }));
    expect(response.status).toBe(201);
    expect((await response.json()).reference).toBe('receipt-id');
    expect(receive.mock.calls[0][0].email).toBe('client@example.test');
  });
  it.each([
    { ...input, consent: false },
    { ...input, website: 'bot.test' },
    { ...input, brief: 'short' },
    { ...input, email: 'invalid' },
    { ...input, request_id: 'bad' },
  ])('rejects invalid payload without persisting data', async (data) => {
    const receive = vi.fn();
    const response = await createEnquiryHandler({ origin, fingerprint: async () => '', receive })(
      req(data),
    );
    expect(response.status).toBe(400);
    expect(receive).not.toHaveBeenCalled();
  });
  it('rejects wrong origins and supports only the expected preflight', async () => {
    const handler = createEnquiryHandler({ origin, fingerprint: async () => '', receive: vi.fn() });
    expect(
      (
        await handler(
          req(input, {
            headers: { origin: 'https://other.test', 'content-type': 'application/json' },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handler(new Request(origin, { method: 'OPTIONS', headers: { origin } }))).status,
    ).toBe(204);
  });
  it('rejects excessive bodies before database writes', async () => {
    const receive = vi.fn();
    const response = await createEnquiryHandler({ origin, fingerprint: async () => '', receive })(
      req({ ...input, brief: 'x'.repeat(26000) }),
    );
    expect(response.status).toBe(413);
    expect(receive).not.toHaveBeenCalled();
  });
  it('reports retry delay and hides internal failure details', async () => {
    let message = 'Too many enquiries. Please try again later.';
    const handler = createEnquiryHandler({
      origin,
      fingerprint: async () => '',
      receive: async () => {
        throw new Error(message);
      },
    });
    let response = await handler(req());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('900');
    message = 'database password confidential-value';
    response = await handler(req());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('confidential-value');
  });
});
it('guided demo advances, resets on role change and can restart without backend access', () => {
  render(
    <MemoryRouter>
      <GuidedDemo />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Build your group' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
  expect(screen.getByRole('heading', { name: 'Submit your proposal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Examiner' }));
  expect(screen.getByRole('heading', { name: 'Find your assigned defense' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
  expect(screen.getByRole('heading', { name: 'Find your assigned defense' })).toBeInTheDocument();
  cleanup();
});

import { validateEngagementWorkspace } from '../engagement/api';
it('malformed engagement responses fail safely without breaking the role workspace', () => {
  expect(() => validateEngagementWorkspace({ role: 'student' })).toThrow(/invalid/);
  expect(() =>
    validateEngagementWorkspace({
      role: 'student',
      reminders_enabled: true,
      onboarding: [null],
      reminders: [],
    }),
  ).toThrow(/invalid/);
  expect(
    validateEngagementWorkspace({
      role: 'student',
      reminders_enabled: true,
      onboarding: [],
      reminders: [],
    }).reminders,
  ).toEqual([]);
});

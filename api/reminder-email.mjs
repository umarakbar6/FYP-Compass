import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { emailSessionAllowed, parseEmailRequest } from '../backend/email/request.mjs';
import { dispatchEmail } from '../backend/email/dispatch.mjs';
async function deliver(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const reply = (status, body) => res.status(status).json(body);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(405, { error: 'Use POST.' });
  }
  const origin = process.env.HEALTH_APP_ORIGIN;
  if (!origin || req.headers.origin !== origin) return reply(403, { error: 'Origin denied.' });
  if (Number(req.headers['content-length'] || 0) > 2000)
    return reply(413, { error: 'Request too large.' });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
    return reply(415, { error: 'Use JSON.' });
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_ANON_KEY,
    service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !service) return reply(503, { error: 'Delivery service is unavailable.' });
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return reply(401, { error: 'Sign in first.' });
  const client = createClient(url, key, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const identity = await client.auth.getUser(token);
  const user = identity.data?.user;
  if (identity.error || !user) return reply(401, { error: 'Invalid session.' });
  if (
    !user.email_confirmed_at ||
    typeof user.email !== 'string' ||
    !/^\S+@\S+\.\S+$/.test(user.email) ||
    user.email.length > 254
  )
    return reply(403, { error: 'A verified registered email is required.' });
  let body;
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw || '') > 2000) return reply(413, { error: 'Request too large.' });
    body = parseEmailRequest(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  } catch {
    return reply(400, { error: 'Approve a valid delivery request.' });
  }
  const profile = await client.from('fyp_profiles').select('role').eq('id', user.id).single();
  if (
    profile.error ||
    (body.type === 'delivery_test'
      ? profile.data.role !== 'coordinator'
      : !['student', 'supervisor'].includes(profile.data.role))
  )
    return reply(403, { error: 'This account role cannot send the requested email.' });
  if (!(await emailSessionAllowed(client, user.id)))
    return reply(403, { error: 'Verify your authenticator before sending email.' });
  if (/\.(?:test|invalid|example|localhost|local)$/i.test(user.email))
    return reply(422, {
      error: 'Demo accounts have no deliverable mailbox. Use a verified real account for email.',
    });
  if (
    process.env.REMINDER_EMAIL_ENABLED !== 'true' ||
    !process.env.FYP_SMTP_USER ||
    !process.env.FYP_SMTP_APP_PASSWORD
  )
    return reply(503, { error: 'Email delivery is not configured.' });
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: process.env.FYP_SMTP_USER, pass: process.env.FYP_SMTP_APP_PASSWORD },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 10000,
  });
  const result = await dispatchEmail({
    body,
    user,
    client,
    admin,
    send: async (message) => {
      const r = await transport.sendMail({
        from: { name: 'FYP Compass', address: process.env.FYP_SMTP_USER },
        ...message,
      });
      if (r.rejected.length || !r.accepted.includes(user.email)) throw Error('Recipient rejected');
    },
  });
  transport.close();
  return reply(result.status, result.body);
}

export default async function handler(req, res) {
  try {
    return await deliver(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Email delivery is temporarily unavailable.' });
  }
}

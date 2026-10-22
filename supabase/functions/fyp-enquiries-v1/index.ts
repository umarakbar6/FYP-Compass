import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createEnquiryHandler } from '../../../backend/engagement/enquiry-handler.ts';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const client = createClient(Deno.env.get('SUPABASE_URL') || '', serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const captchaSecret = Deno.env.get('TURNSTILE_SECRET_KEY') || '',
  captchaRequired = Boolean(captchaSecret) || Deno.env.get('TURNSTILE_REQUIRED') === 'true';
const handler = createEnquiryHandler({
  origin: Deno.env.get('HEALTH_APP_ORIGIN') || '',
  verifyCaptcha: captchaRequired
    ? async (token, requestId) => {
        if (!captchaSecret) throw Error('Security verification is not configured.');
        if (typeof token !== 'string' || !token || token.length > 2048) return false;
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            secret: captchaSecret,
            response: token,
            idempotency_key: requestId,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Error('Security verification unavailable.');
        const result = await response.json();
        return (
          result.success === true &&
          result.action === 'enquiry' &&
          result.hostname === new URL(Deno.env.get('HEALTH_APP_ORIGIN') || '').hostname
        );
      }
    : undefined,
  fingerprint: async (_request, input) => {
    // Store a keyed pseudonym, never the raw address or the server credential.
    const address = input.email.trim().toLowerCase(); // Spoofable forwarding headers are not a security boundary.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(serviceKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address));
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  },
  receive: async (input, hash) => {
    const { data, error } = await client.rpc('fyp_engagement_receive_enquiry', {
      p_request_id: input.request_id,
      p_name: input.name,
      p_email: input.email,
      p_plan: input.plan,
      p_brief: input.brief,
      p_consent: input.consent,
      p_abuse_hash: hash,
    });
    if (error) throw Object.assign(new Error('Enquiry save failed.'), { code: error.code });
    return data;
  },
});
Deno.serve(handler);

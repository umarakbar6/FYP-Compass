export interface EnquiryInput { request_id: string; name: string; email: string; plan: string; brief: string; consent: boolean; }
interface Options { verifyCaptcha?: (token:unknown,requestId:string)=>Promise<boolean>; origin: string; fingerprint: (request: Request, input: EnquiryInput) => Promise<string>; receive: (input: EnquiryInput, hash: string) => Promise<{ reference: string; status: string }>; }
export function createEnquiryHandler(options: Options) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': options.origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    if (request.headers.get('origin') !== options.origin) return reply(403, { error: 'This origin is not allowed.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Use POST to send an enquiry.' });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply(415, { error: 'A JSON request is required.' });
    try {
      let size = 0; const chunks: Uint8Array[] = []; const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: 'The enquiry is missing.' });
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 24576) { await reader.cancel(); return reply(413, { error: 'The enquiry is too large.' }); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reply(400, { error: 'Check your enquiry details.' });
      const value = raw as Record<string, unknown>;
      if (value.website || typeof value.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.request_id) || typeof value.name !== 'string' || typeof value.email !== 'string' || typeof value.brief !== 'string' || !['Basic', 'Regular', 'Advance'].includes(String(value.plan)) || value.consent !== true) return reply(400, { error: 'Complete all required fields and agree to follow-up.' });
      const input: EnquiryInput = { request_id: value.request_id, name: value.name.trim(), email: value.email.trim().toLowerCase(), plan: String(value.plan), brief: value.brief.trim(), consent: true };
      if (input.name.length < 2 || input.name.length > 120 || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.brief.length < 20 || input.brief.length > 6000) return reply(400, { error: 'Use a valid email, a 2–120 character name and a 20–6,000 character project brief.' });
      if(options.verifyCaptcha&&!await options.verifyCaptcha(value.captcha_token,input.request_id))return reply(403,{error:'Security verification expired or failed. Complete it again.'});
      const receipt = await options.receive(input, await options.fingerprint(request,input));
      return reply(201, receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (error instanceof SyntaxError) return reply(400, { error: 'The enquiry format is invalid.' });
      if ((error as {code?:string})?.code==='P0429' || message.startsWith('Too many enquiries')) return new Response(JSON.stringify({ error: 'Too many enquiries. Please try again later.' }), { status: 429, headers: { ...headers, 'Retry-After': '900' } });
      if ((error as {code?:string})?.code==='22023' || message.startsWith('Invalid enquiry') || message.startsWith('Retry key belongs')) return reply(400, { error: 'The enquiry changed. Review the details and submit again.' });
      console.error(JSON.stringify({event:'enquiry_backend_unavailable',reference:crypto.randomUUID()}));
      return reply(503, { error: 'We could not confirm your request. Retry with the same details; duplicate submissions are prevented.' });
    }
  };
}

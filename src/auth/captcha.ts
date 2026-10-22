// The public key alone grants no server access. Supabase validates tokens privately.
export const authCaptchaRequired = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);
export function validatedCaptchaToken(token?: string): string | undefined {
  if (authCaptchaRequired && (!token || token.length > 2048))
    throw Error('Complete the security verification before continuing.');
  return authCaptchaRequired ? token : undefined;
}

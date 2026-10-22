import { useEffect, useRef } from 'react';
interface Widget {
  render: (container: HTMLElement, config: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: Widget;
  }
}
export const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '');
export function Turnstile({
  onToken,
  revision,
  action = 'enquiry',
}: {
  onToken: (token: string) => void;
  revision: number;
  action?: 'enquiry' | 'login' | 'signup' | 'recovery' | 'resend';
}) {
  const element = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    if (!turnstileSiteKey) return;
    let active = true,
      id: string | undefined;
    const render = () => {
      if (active && element.current && window.turnstile && !id)
        id = window.turnstile.render(element.current, {
          sitekey: turnstileSiteKey,
          action,
          size: 'flexible',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(''),
          'error-callback': () => callback.current(''),
        });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-fyp-turnstile]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.dataset.fypTurnstile = 'true';
      document.head.append(script);
    }
    script.addEventListener('load', render);
    render();
    return () => {
      active = false;
      script?.removeEventListener('load', render);
      if (id) window.turnstile?.remove(id);
    };
  }, [revision, action]);
  return turnstileSiteKey ? (
    <div
      ref={element}
      aria-label={
        action === 'enquiry' ? 'Enquiry security verification' : 'Account security verification'
      }
    />
  ) : null;
}

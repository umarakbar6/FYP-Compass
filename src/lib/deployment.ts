export const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || '';
export function applicationOrigin(): string {
  const origin = import.meta.env.VITE_APP_ORIGIN?.trim() || window.location.origin;
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== 'https:' && !import.meta.env.DEV))
    throw new Error('The application origin configuration is invalid.');
  return url.origin;
}

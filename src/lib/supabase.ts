import { createClient } from '@supabase/supabase-js';
import { browserAuthStorage } from '../security/auth-storage';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const hasBackendConfig = Boolean(url && key);
export const demoEnabled =
  !url && !key && (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true');
let configurationError: string | null = null;
export const supabase = (() => {
  if (!url || !key) {
    if (url || key)
      configurationError =
        'Both Supabase URL and public key are required. Check your environment configuration.';
    return null;
  }
  try {
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    return createClient(url, key, {
      auth: { storageKey, storage: browserAuthStorage(storageKey) },
    });
  } catch {
    configurationError =
      'The Supabase configuration is invalid. Check the project URL and public key.';
    return null;
  }
})();
export const backendError = configurationError;

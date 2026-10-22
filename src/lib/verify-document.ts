import { coreV2, localBackend } from './backend-version';
import { supabase } from './supabase';
export async function verifyUploadedDocument(path: string, name: string) {
  if (!coreV2 || localBackend) return;
  if (!supabase) throw new Error('Storage connection is unavailable.');
  const { data, error } = await supabase.functions.invoke('fyp-file-verify-v1', {
    body: { path, name },
  });
  if (error) {
    let message = 'Document verification failed. Use a plain PDF or DOCX and retry.';
    try {
      const value = await error.context?.json();
      if (typeof value?.error === 'string' && value.error.length <= 250) message = value.error;
    } catch {
      /* Keep the safe failure message. */
    }
    throw new Error(message);
  }
  if (data?.verified !== true || data?.method !== 'screen_v1')
    throw new Error('The server did not verify this document.');
}

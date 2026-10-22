import { useEffect, useRef, useState } from 'react';
import type { ProposalDocument } from '../types/student';
import { Button, ErrorMessage } from './ui';
export function PrivateDocumentLink({
  document,
  resolveUrl,
}: {
  document: ProposalDocument;
  resolveUrl: (document: ProposalDocument) => Promise<string>;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setUrl('');
    setError('');
    setBusy(false);
    return () => {
      revision.current++;
    };
  }, [document.path]);
  useEffect(() => {
    if (!url) return;
    const timer = window.setTimeout(() => setUrl(''), 60000);
    return () => window.clearTimeout(timer);
  }, [url]);
  async function generate() {
    const request = ++revision.current;
    setBusy(true);
    setError('');
    setUrl('');
    try {
      const value = await resolveUrl(document);
      if (request === revision.current) setUrl(value);
    } catch (cause) {
      if (request === revision.current)
        setError(
          cause instanceof Error ? cause.message : 'Could not prepare the private document link.',
        );
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => void generate()}>
        {busy
          ? 'Preparing private link…'
          : url
            ? 'Refresh private link'
            : 'Get private document link'}
      </Button>
      {url && (
        <a className="text-link" href={url} target="_blank" rel="noopener noreferrer">
          Open document · valid for 60 seconds
        </a>
      )}
      {error && <ErrorMessage message={error} />}
    </>
  );
}

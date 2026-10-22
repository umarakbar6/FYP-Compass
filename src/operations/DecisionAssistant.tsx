import { readableCopy } from '../lib/readable-copy';
import { ProposalEvidenceNotice } from './ProposalEvidenceNotice';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { validateDraft, type Draft } from '../../backend/agents/engine';
interface Saved {
  id: string;
  project_id: string | null;
  kind: string;
  status: string;
  source: string;
  created_at: string;
  draft: Draft | null;
}
export function DecisionAssistant({
  projectId,
  kind,
}: {
  projectId: string;
  kind: 'proposal' | 'document';
}) {
  const { user } = useAuth();
  const actor = useRef(user?.id);
  actor.current = user?.id;
  const [draft, setDraft] = useState<Saved | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setDraft(null);
    setUnavailable(false);
    let active = true;
    const started = actor.current;
    if (supabase)
      void Promise.resolve(supabase.rpc('fyp_agents_history'))
        .then(({ data, error }) => {
          if (!active || actor.current !== started) return;
          if (error) {
            setUnavailable(true);
            return;
          }
          if (Array.isArray(data)) {
            const candidate =
              data.find(
                (r: Saved) =>
                  r.project_id === projectId &&
                  r.kind === kind &&
                  r.status === 'draft' &&
                  r.source === 'gemini' &&
                  r.draft,
              ) || null;
            if (candidate) validateDraft(candidate.draft);
            setDraft(candidate);
          }
        })
        .catch(() => {
          if (active && actor.current === started) setUnavailable(true);
        });
    return () => {
      active = false;
    };
  }, [user?.id, projectId, kind]);
  return (
    <section className="panel phase-form">
      <h2>{kind === 'proposal' ? 'AI proposal review' : 'AI document summary'}</h2>
      <p>
        Advisory evidence only. Read the original submission and make your own decision. A saved
        draft may predate recent edits.
      </p>
      {kind === 'proposal' && <ProposalEvidenceNotice />}
      {kind === 'document' && (
        <p>
          The summarizer reads the two latest versions of the most recently submitted milestone in
          this project.
        </p>
      )}
      {unavailable && (
        <p>Saved drafts are temporarily unavailable. Continue using the original evidence.</p>
      )}
      {draft?.project_id === projectId && draft.kind === kind ? (
        <>
          <p>{readableCopy(draft.draft?.summary || '')}</p>
          <ul>
            {draft.draft?.findings.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
          <small>
            Gemini draft saved {new Date(draft.created_at).toLocaleString()} · Reference {draft.id}
          </small>
        </>
      ) : (
        <p>No verified saved draft is available for this account and project.</p>
      )}
      <p>
        <Link
          className="text-link"
          to={`/${user?.role}/assistants?kind=${kind}&project=${encodeURIComponent(projectId)}`}
        >
          Open {kind === 'proposal' ? 'proposal review assistant' : 'document summarizer'}
        </Link>
      </p>
    </section>
  );
}

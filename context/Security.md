# Security boundaries

Real keys, passwords, privileged tokens, authenticator seeds, recovery links, backups and operational logs are excluded from this public source tree. `.env` files remain local; examples contain placeholders only. CI has no production secret or deployment token.

Use verified Auth identities and protected database profiles; require staff MFA and current sessions according to deployment policy. RPCs recheck roles and assignments, fixed search paths constrain privileged functions, and RLS protects rows. Public request predicates are not general anonymous business access. Configure provider account MFA separately from application MFA.

Storage uses private buckets, bounded file sizes, MIME/extension/content checks, archive expansion/path controls, owner/group authorization and content attestations. These layers are not full antivirus certification. APIs reject foreign origins, invalid sessions, unexpected fields and excessive input. CSP and related headers restrict browser capabilities.

AI requests require authorized evidence, consent and transactional budgets; generated text is advisory and rendered as text. Shared markup extraction advances linearly over untrusted input. Release fingerprints include shared HTTP and health backend modules.

Gitleaks, native GitHub push protection, dependency updates, read-only CI tokens, pinned actions and branch checks complement human review. The exact SQL fixture exception in `.gitleaks.toml` is narrowly constrained by both fixture path and the exact public SQL identifier fragment. Public source does not make production testing authorized or guarantee universal security.

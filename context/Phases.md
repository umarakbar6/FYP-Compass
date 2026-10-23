# Development phases

1. Interface and authentication: layouts, sessions, signup/recovery and four role guards.
2. Student group and proposal: enrollment, group membership, topics, preferences and submission controls.
3. Supervisor review: assigned proposals, revision/rejection comments and justified decisions.
4. Milestones and contributions: private document evidence, rework, stale-version controls and member statements.
5. Similarity: internal comparison plus optional consented public-source evidence; human academic review.
6. Health rules: deterministic Green/Amber/Red classification with stored evidence and versions.
7. Health assistant and notices: bounded Gemini drafts, validated fallback, supervisor review and private publication.
8. Responsive presentation and validation: role routing, isolated database tests, UI regression and browser checks.

Backend integration also includes coordinator configuration, preference-first allocation, confidential peer review, defense scheduling, examiner/supervisor marks, released results, justified corrections and audit records. Later extensions include reminders, onboarding, public service enquiries, privacy requests, account limits, file screening and AI guardrails.

Code availability is separate from live acceptance. Run CI for the exact checkout; configure provider credentials, institutional policies, SMTP, MFA and deployment-specific checks privately.

## Acceptance against the original, unsplit PRD

The complete original brief is preserved in `docs/ORIGINAL-MVP-PRD.md`; its ten detailed procedures are in `docs/ORIGINAL-TEN-ACCEPTANCE-CASES.md`. Acceptance now binds those exact procedures, including the two-point topic cap, first-choice versus third-choice competition, distinct Late/Overdue evidence and edited supervisor notices.

Corrections also cover dashboard text contrast, an ambiguous browser-test selector, complete local RPC availability, session revocation, document attestations and shared AI persistence. Test results belong to the exact tested source and dated verification artifacts; source completeness alone is never a passing acceptance result.

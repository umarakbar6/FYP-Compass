# Error handling

Authentication/profile failures clear protected workspace state. Late results are bound to the approving actor/project and cannot populate another account. Invalid or revoked sessions and unmet MFA fail closed. Signup/recovery preserve safe user input and provide bounded retry behavior without exposing provider payloads.

Database writes validate expected versions, current evidence, membership and role before commit. Conflicts require refresh rather than silent overwrite. File verification failure leaves the upload unattached; forged paths, unsafe archives, excessive expansion or unsupported content are rejected. Shared text extraction avoids repeated suffix scans on malformed markup.

AI generation uses bounded request/response bytes and deadlines, narrow transient retries, finish/safety/schema checks and trusted reference sets. Invalid drafts cannot be published. Health fallback is labeled and does not invent successful Gemini execution. SMTP claims/idempotency prevent blind resend after uncertain delivery.

Operational failures use sanitized messages and references, not credentials or raw private logs. An incomplete scan is not a passing security result. Dependency alerts, provider MFA, backup restoration and production acceptance remain independently verified operational concerns.

## Added completion regressions

The internal service adapter resolves overloaded SQL functions against the actual named arguments. It rejects an unsupported signature instead of silently dropping data; this fixes private AI-draft persistence through the local bridge. Consent failures stop before a provider call, and malformed output marks a reserved run failed with no draft.

Local startup verifies the installed schema digest. A mismatched old data directory stops with guidance rather than resetting its contents. Port conflicts also stop; the start command does not stop another application or connect silently to an unrelated backend. Existing data and historical allocation decisions are preserved during the additive PRD correction.

Private database exports are bound to the initiating coordinator and discarded after account change or unmount. Complete report print verification is a separate gate, not inferred from the summary or SQL totals.

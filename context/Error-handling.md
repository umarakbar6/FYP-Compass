# Error handling

Authentication/profile failures clear protected workspace state. Late results are bound to the approving actor/project and cannot populate another account. Invalid or revoked sessions and unmet MFA fail closed. Signup/recovery preserve safe user input and provide bounded retry behavior without exposing provider payloads.

Database writes validate expected versions, current evidence, membership and role before commit. Conflicts require refresh rather than silent overwrite. File verification failure leaves the upload unattached; forged paths, unsafe archives, excessive expansion or unsupported content are rejected. Shared text extraction avoids repeated suffix scans on malformed markup.

AI generation uses bounded request/response bytes and deadlines, narrow transient retries, finish/safety/schema checks and trusted reference sets. Invalid drafts cannot be published. Health fallback is labeled and does not invent successful Gemini execution. SMTP claims/idempotency prevent blind resend after uncertain delivery.

Operational failures use sanitized messages and references, not credentials or raw private logs. An incomplete scan is not a passing security result. Dependency alerts, provider MFA, backup restoration and production acceptance remain independently verified operational concerns.

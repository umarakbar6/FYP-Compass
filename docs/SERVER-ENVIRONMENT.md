# Server environment configuration

The browser receives only the approved `VITE_` variables listed in `.env.example`. Cloud builds reject unapproved browser variables and inspect emitted assets for credential patterns, elevated JWTs and actual sensitive server variable values.

| Runtime | Variables | Handling |
| --- | --- | --- |
| Supabase Edge | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Platform project values; service key never belongs in a Vite variable. |
| Supabase Edge AI | `GEMINI_API_KEY`, `GEMINI_MODEL`, optional `GEMINI_DOCUMENT_MODEL`, `GEMINI_QA_MODEL` | Store in project secrets. Missing configuration fails closed. |
| Supabase QA | `FYP_QA_REVIEW_APPROVED_SHA256` | Exact approval for the fixed selected QA payload; do not regenerate or export a new payload without approval. |
| Supabase and Vercel | `HEALTH_APP_ORIGIN=https://fyp-compass-ten.vercel.app` | Exact trusted origin. CORS is supplementary; authentication, active-session checks and ownership are the security boundary. |
| Supabase invitations | `INVITES_ENABLED=true` | Enable only after custom SMTP verification. Coordinator role and explicit roster approval are required. |
| Vercel reminder API | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REMINDER_EMAIL_ENABLED=true`, `FYP_SMTP_USER`, `FYP_SMTP_APP_PASSWORD` | Server-only environment. Gmail SMTP uses STARTTLS with certificate verification. No password or custom recipient comes from the browser. |
| Optional public enquiry CAPTCHA | `TURNSTILE_SECRET_KEY`, `TURNSTILE_REQUIRED=true` on Edge and `VITE_TURNSTILE_SITE_KEY` in Vercel | A real Cloudflare site/secret pair must be provisioned. A public site key is not a secret. This enquiry widget does not automatically protect Supabase Auth signup/login. |

Never use production secret values in examples or source. `.private/`, real `.env` files, CLI state and credential handovers are excluded from Vercel uploads. Keep private credential files access controlled; deliver them separately from the source archive.

If any credential was previously committed, uploaded publicly or shared with an unauthorized recipient, rotate it at the owning provider. Removing the current file does not remove Git history or revoke a key. This working copy has no Git repository, so historical leakage cannot be verified here.

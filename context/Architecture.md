# Architecture

FYP Compass uses React, TypeScript and Vite for the browser; Supabase Auth, PostgreSQL/RPCs, private Storage and Edge Functions for academic workflows; and a Vercel API for authenticated SMTP dispatch. Browser code receives only locally configured public connection values. Service credentials remain server-only.

`src` contains role workspaces and UI adapters. `api` contains Vercel handlers. `backend/agents`, `backend/health-agent`, `backend/http` and `backend/email` hold shared bounded processing. `supabase/functions` contains deployable entries; `supabase/migrations` contains canonical schema changes. `backend/local-tests` models isolated Auth/Storage infrastructure for database regressions.

Roles are student, supervisor, examiner and coordinator. Database profiles, session validity, assignments and MFA determine access. Staff review academic decisions and AI drafts. Public navigation is not an authorization grant. See Database.md for persistence and Security.md for trust boundaries.

## Original PRD completion, 23 October 2026

The local HTTP bridge now installs the complete 31-migration production schema, including pgvector, governance, reminder, operational and privacy domains. The browser uses the actual Supabase SDK against that loopback bridge. Production continues to use Supabase Auth and Storage; local identities and local Storage are isolated test adapters.

`backend/agents/handler.ts` is shared by the deployed `fyp-assistants-v1` entry and the local function adapter. The health handler was already shared. Both paths keep request validation, actor/assignment checks, quotas, grounded output and private draft persistence. `npm run demo:local` starts the website and persistent local database together; it never connects to the cloud database.

The report summary links to the complete accreditation view with the selected session. The full view reuses the protected accreditation RPC and prints all marks; summary pagination remains available.

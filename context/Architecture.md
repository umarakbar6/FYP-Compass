# Architecture

FYP Compass uses React, TypeScript and Vite for the browser; Supabase Auth, PostgreSQL/RPCs, private Storage and Edge Functions for academic workflows; and a Vercel API for authenticated SMTP dispatch. Browser code receives only locally configured public connection values. Service credentials remain server-only.

`src` contains role workspaces and UI adapters. `api` contains Vercel handlers. `backend/agents`, `backend/health-agent`, `backend/http` and `backend/email` hold shared bounded processing. `supabase/functions` contains deployable entries; `supabase/migrations` contains canonical schema changes. `backend/local-tests` models isolated Auth/Storage infrastructure for database regressions.

Roles are student, supervisor, examiner and coordinator. Database profiles, session validity, assignments and MFA determine access. Staff review academic decisions and AI drafts. Public navigation is not an authorization grant. See Database.md for persistence and Security.md for trust boundaries.

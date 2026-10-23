# Database

PostgreSQL is accessed through Auth-bound RPCs and row-level policies. Canonical order is recorded in `supabase/migration-order.json`; the repository includes 31 migrations and generated fresh-install SQL. `npm run db:check` verifies generated installers. Never replay the foundation over an existing database.

Domains include profiles and verified registration; academic sessions/topics/groups/proposals/allocations; milestones and contributions; assessments/defenses/results; project health/notices; engagement and reminders; AI runs and semantic evidence; governance; operational telemetry; privacy requests; account capacity and security sessions.

Students are restricted to their groups. Supervisors act on allocations, examiners on assigned defenses, and coordinators on authorized administration. Protected functions fix search paths and validate the actor; version/evidence checks reject stale decisions. Owner assignment is an administrator-controlled pin, never signup metadata. Existing capacity rules support 100 students, 10 supervisors and 2 ordinary coordinators with the pinned owner separate.

Academic documents use private object paths and short-lived authorized links. Content verification records bind digest, size, MIME and owner/path before attachment. Isolated database tests model Auth sessions/factors and synthetic Storage without production credentials or records.

## Original matching rule restored

`202610230001_prd_matching_cap.sql` restores the original PRD: preference rounds 1, 2 and 3 run first, and topic tie points are capped at TWO even when three tags overlap. A recorded seed resolves equal points. New allocations also record capped points, shared-tag count, capacity before allocation and lottery use. Existing allocations are preserved as historical decisions; optional new fields may be null on them.

The full installer contains 31 canonical migrations. The base academic installer contains its original eight foundations plus the additive matching fix. Existing cloud databases receive only the additive migration, never the fresh installer. `backend/MIGRATION-PROVENANCE.csv` identifies every canonical input and digest. The PRD cap migration was independently checked on the owned cloud project after application.

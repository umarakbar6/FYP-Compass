-- Deployment bookkeeping, independent of the application baseline.
create table if not exists fyp_ops_v1.release_migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now());
alter table fyp_ops_v1.release_migrations enable row level security;
revoke all on fyp_ops_v1.release_migrations from public,anon,authenticated;

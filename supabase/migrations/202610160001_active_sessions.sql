-- Reject replay of signed access tokens after their Supabase session is revoked.
-- No identities, academic records or existing sessions are removed by this migration.
begin;
create schema if not exists fyp_security_v1;
revoke all on schema fyp_security_v1 from public,anon,authenticated;

create or replace function public.fyp_session_active() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb;session_uuid uuid;actor uuid;
begin
 actor:=auth.uid();
 if actor is null then return false;end if;
 begin
  claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
  if claims->>'role' is distinct from 'authenticated' then return false;end if;
  session_uuid:=(claims->>'session_id')::uuid;
 exception when invalid_text_representation then return false;
 end;
 if session_uuid is null then return false;end if;
 return exists(select 1 from auth.sessions s where s.id=session_uuid and s.user_id=actor
  and (s.not_after is null or s.not_after>now()));
end$$;
revoke all on function public.fyp_session_active() from public,anon;
grant execute on function public.fyp_session_active() to authenticated,service_role;

create or replace function fyp_core_v2.role(expected text default null) returns text
language plpgsql stable security definer set search_path='' as $$
declare r text;begin
 if not public.fyp_session_active() then raise exception 'Session is no longer active. Sign in again.' using errcode='42501';end if;
 select role::text into r from public.fyp_profiles where id=auth.uid();
 if r is null or (expected is not null and r<>expected) then
  raise exception 'Role is not permitted' using errcode='42501';end if;
 return r;
end$$;
create or replace function fyp_health_v2.role() returns text
language plpgsql stable security definer set search_path='' as $$
begin return fyp_core_v2.role();end$$;

drop policy if exists fyp_active_session on public.fyp_profiles;
create policy fyp_active_session on public.fyp_profiles as restrictive
for select to authenticated using(public.fyp_session_active());

-- PostgREST covers RPCs that do not pass through the shared role helper.
-- Storage also calls the role helper through its existing ownership policies.
create or replace function public.fyp_check_request() returns void
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb;begin
 claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 if claims->>'role'='authenticated' and not public.fyp_session_active() then
  raise exception 'Session is no longer active. Sign in again.' using errcode='42501';end if;
end$$;
revoke all on function public.fyp_check_request() from public;
grant execute on function public.fyp_check_request() to anon,authenticated,service_role;
do $$declare previous text;begin
 if exists(select 1 from pg_roles where rolname='authenticator') then
  select substring(setting from length('pgrst.db_pre_request=')+1) into previous
   from pg_roles r cross join lateral unnest(r.rolconfig) setting
   where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
  if previous is not null and previous not in ('','public.fyp_check_request') then
   raise exception 'An existing API pre-request hook must be composed before installing the session guard';end if;
  execute 'alter role authenticator set pgrst.db_pre_request=''public.fyp_check_request''';
 end if;
 if to_regclass('fyp_ops_v1.release_migrations') is not null then
  alter table fyp_ops_v1.release_migrations enable row level security;
 end if;
end$$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;

-- Role profiles may only be assigned by an administrator, never by the browser.
begin;
create table if not exists public.fyp_profiles(id uuid primary key references auth.users(id),full_name text not null,role text not null check(role in ('student','supervisor','examiner','coordinator')));
alter table public.fyp_profiles enable row level security;
revoke all on public.fyp_profiles from anon;
revoke insert,update,delete on public.fyp_profiles from authenticated;
revoke insert(id,role,full_name),update(id,role,full_name) on public.fyp_profiles from authenticated;
revoke select(id,role,full_name),insert(id,role,full_name),update(id,role,full_name) on public.fyp_profiles from anon;
grant select on public.fyp_profiles to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then execute 'grant select,insert,update,delete on public.fyp_profiles to service_role';end if;end $$;
do $$begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='fyp_profiles' and policyname='fyp_v2_own_profile') then create policy fyp_v2_own_profile on public.fyp_profiles for select to authenticated using(id=auth.uid());end if;end $$;
do $$begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='fyp_profiles' and policyname='fyp_v2_profile_guard') then create policy fyp_v2_profile_guard on public.fyp_profiles as restrictive for select to authenticated using(id=auth.uid());end if;end $$;
commit;

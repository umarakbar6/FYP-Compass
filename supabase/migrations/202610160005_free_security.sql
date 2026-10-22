-- Free security operations. No academic rows, identities or factors are deleted.
begin;
create table fyp_security_v1.settings(
 singleton boolean primary key default true check(singleton),
 require_staff_mfa boolean not null default false,
 demo_access_enabled boolean not null default true,
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into fyp_security_v1.settings(singleton)values(true);
create table fyp_security_v1.events(
 id uuid primary key default gen_random_uuid(),event_key text unique not null,
 actor uuid,kind text not null check(kind in('session_observed','policy_changed','alert_reviewed')),
 created_at timestamptz not null default now()
);
create index on fyp_security_v1.events(created_at);
create index on fyp_security_v1.events(actor,created_at);
create table fyp_security_v1.alerts(
 id uuid primary key default gen_random_uuid(),dedupe_key text unique not null,
 kind text not null check(kind in('session_burst','ai_failures','staff_mfa_gap','demo_access')),
 severity text not null check(severity in('warning','critical')),
 total integer not null check(total>=0),
 created_at timestamptz not null default now(),reviewed_at timestamptz,
 reviewed_by uuid
);
alter table fyp_security_v1.settings enable row level security;
alter table fyp_security_v1.events enable row level security;
alter table fyp_security_v1.alerts enable row level security;
revoke all on all tables in schema fyp_security_v1 from public,anon,authenticated,service_role;

create function fyp_security_v1.has_factor(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path=''as $$
begin
 if to_regclass('auth.mfa_factors') is null then return false;end if;
 return exists(select 1 from auth.mfa_factors where user_id=p_actor and status::text='verified');
end$$;

create function fyp_security_v1.is_demo(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path=''as $$
begin
 return exists(select 1 from auth.users where id=p_actor and lower(email)like '%@demo.fypcompass.test');
end$$;

-- Keep the base session check separate so own-profile + MFA bootstrap can work.
create function fyp_security_v1.base_session_active() returns boolean
language plpgsql stable security definer set search_path=''as $$
declare claims jsonb;s uuid;actor uuid;
begin
 actor:=auth.uid();if actor is null then return false;end if;
 begin
  claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
  if claims->>'role' is distinct from 'authenticated' then return false;end if;
  s:=(claims->>'session_id')::uuid;
 exception when invalid_text_representation then return false;end;
 return s is not null and exists(select 1 from auth.sessions where id=s and user_id=actor and(not_after is null or not_after>now()));
end$$;

create or replace function public.fyp_session_active()returns boolean
language plpgsql stable security definer set search_path=''as $$
begin
 if not fyp_security_v1.base_session_active()then return false;end if;
 if not(select demo_access_enabled from fyp_security_v1.settings where singleton)
  and fyp_security_v1.is_demo(auth.uid())then return false;end if;
 return true;
end$$;

create function fyp_security_v1.mfa_satisfied()returns boolean
language plpgsql stable security definer set search_path=''as $$
declare required boolean;verified boolean;claims jsonb;
begin
 verified:=fyp_security_v1.has_factor(auth.uid());
 required:=verified or ((select require_staff_mfa from fyp_security_v1.settings where singleton)
  and exists(select 1 from public.fyp_profiles where id=auth.uid()and role::text<>'student'));
 if not required then return true;end if;
 claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 return verified and coalesce(claims->>'aal'='aal2',false);
end$$;

create or replace function fyp_core_v2.role(expected text default null)returns text
language plpgsql stable security definer set search_path=''as $$
declare r text;begin
 if not public.fyp_session_active()then raise exception 'Session ended or demo access is disabled. Sign in with your own account.'using errcode='42501';end if;
 if not fyp_security_v1.mfa_satisfied()then raise exception 'Authenticator verification is required.'using errcode='42501';end if;
 select role::text into r from public.fyp_profiles where id=auth.uid();
 if r is null or(expected is not null and r<>expected)then raise exception 'Role is not permitted'using errcode='42501';end if;
 return r;
end$$;

create function fyp_security_v1.observe_session()returns void
language plpgsql volatile security definer set search_path=''as $$
declare claims jsonb;begin
 claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 insert into fyp_security_v1.events(event_key,actor,kind)
 values('session:'||(claims->>'session_id'),auth.uid(),'session_observed')on conflict(event_key)do nothing;
end$$;

-- The only AAL1 exceptions expose the actor's own profile and MFA bootstrap.
-- Private data RPCs, role helpers and storage operations still require AAL2.
create or replace function public.fyp_check_request()returns void
language plpgsql volatile security definer set search_path=''as $$
declare claims jsonb;path text;begin
 claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 if claims->>'role'='authenticated'then
  if not public.fyp_session_active()then raise exception 'Session ended or demo access is disabled. Sign in with your own account.'using errcode='42501';end if;
  path:=coalesce(current_setting('request.path',true),'');
  if path not in('/fyp_profiles','/rpc/fyp_security_context')and not fyp_security_v1.mfa_satisfied()then
   raise exception 'Authenticator verification is required.'using errcode='42501';end if;
  -- PostgREST marks GET/HEAD transactions read-only. Never write during them.
  if current_setting('transaction_read_only')='off'then perform fyp_security_v1.observe_session();end if;
 end if;
end$$;

create function public.fyp_security_context()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare r text;verified boolean;cfg fyp_security_v1.settings;
begin
 if not public.fyp_session_active()then raise exception 'Active personal account required'using errcode='42501';end if;
 select role::text into r from public.fyp_profiles where id=auth.uid();
 if r is null then raise exception 'Role profile required'using errcode='42501';end if;
 select * into cfg from fyp_security_v1.settings where singleton;
 verified:=fyp_security_v1.has_factor(auth.uid());
 perform fyp_security_v1.observe_session();
 return jsonb_build_object('actor_id',auth.uid(),'mfa_required',not fyp_security_v1.mfa_satisfied(),
  'has_verified_factor',verified,'staff_mfa_required',cfg.require_staff_mfa,'demo_access_enabled',cfg.demo_access_enabled,
  'is_owner',exists(select 1 from fyp_accounts_v1.settings where singleton and owner_id=auth.uid()),'version',cfg.version);
end$$;

create function fyp_security_v1.collect_alerts()returns void
language plpgsql volatile security definer set search_path=''as $$
declare n integer;begin
 perform pg_advisory_xact_lock(hashtextextended('fyp-security-alerts',0));
 insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)
 select 'sessions:'||actor::text||':'||date_trunc('hour',created_at)::text,'session_burst','warning',count(*)::integer
 from fyp_security_v1.events where kind='session_observed'and created_at>now()-interval '24 hours'group by actor,date_trunc('hour',created_at)having count(*)>=20
 on conflict(dedupe_key)do update set total=excluded.total;
 select count(*)::integer into n from public.fyp_profiles p where p.role::text<>'student'and not fyp_security_v1.has_factor(p.id);
 if n>0 then
  insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)values('staff-mfa:'||current_date,'staff_mfa_gap','warning',n)
  on conflict(dedupe_key)do update set total=excluded.total;
 else update fyp_security_v1.alerts set reviewed_at=coalesce(reviewed_at,now())where kind='staff_mfa_gap';end if;
 if(select demo_access_enabled from fyp_security_v1.settings where singleton)then
  insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)values('demo:'||current_date,'demo_access','warning',1)on conflict(dedupe_key)do nothing;
 else update fyp_security_v1.alerts set reviewed_at=coalesce(reviewed_at,now())where kind='demo_access';end if;
 if to_regclass('fyp_ops_v1.ai_runs')is not null then
  select count(*)::integer into n from fyp_ops_v1.ai_runs where status='failed'and created_at>now()-interval '1 hour';
  if n>=3 then insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)values('ai:'||date_trunc('hour',now()),'ai_failures','critical',n)
   on conflict(dedupe_key)do update set total=excluded.total;end if;
 end if;
 -- Retention applies only to these newly introduced operational records.
 delete from fyp_security_v1.events where created_at<now()-interval '90 days';
 delete from fyp_security_v1.alerts where reviewed_at<now()-interval '30 days';
end$$;

create function public.fyp_security_dashboard()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 perform fyp_core_v2.role('coordinator');perform fyp_security_v1.collect_alerts();
 return public.fyp_security_context()||jsonb_build_object('checked_at',now(),
  'observed_sessions_24h',(select count(*)from fyp_security_v1.events where kind='session_observed'and created_at>now()-interval '24 hours'),
  'alerts',(select coalesce(jsonb_agg(to_jsonb(a)order by a.created_at desc),'[]')from(select id,kind,severity,total,created_at,reviewed_at from fyp_security_v1.alerts order by created_at desc limit 100)a),
  'staff',(select coalesce(jsonb_agg(to_jsonb(s)order by s.role,s.full_name),'[]')from(
   select p.id,p.full_name,p.role,fyp_security_v1.has_factor(p.id)as mfa_enabled,
    p.id=(select owner_id from fyp_accounts_v1.settings where singleton)as is_owner
   from public.fyp_profiles p where p.role::text<>'student')s));
end$$;

create function public.fyp_security_update(p_require_staff_mfa boolean,p_demo_access_enabled boolean,p_version integer)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 perform fyp_core_v2.role('coordinator');
 if not exists(select 1 from fyp_accounts_v1.settings where singleton and owner_id=auth.uid())then raise exception 'Only the pinned owner can change access policy'using errcode='42501';end if;
 if not fyp_security_v1.has_factor(auth.uid())or not fyp_security_v1.mfa_satisfied()
  or(nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'aal'is distinct from 'aal2'then
  raise exception 'Verify your own authenticator before changing security policy'using errcode='42501';end if;
 if p_require_staff_mfa is null or p_demo_access_enabled is null or p_version is null then raise exception 'Invalid policy'using errcode='22023';end if;
 update fyp_security_v1.settings set require_staff_mfa=p_require_staff_mfa,demo_access_enabled=p_demo_access_enabled,version=version+1,updated_at=now()where singleton and version=p_version;
 if not found then raise exception 'Policy changed. Refresh before saving.'using errcode='40001';end if;
 insert into fyp_security_v1.events(event_key,actor,kind)values('policy:'||gen_random_uuid(),auth.uid(),'policy_changed');
 return public.fyp_security_dashboard();
end$$;

create function public.fyp_security_review_alert(p_id uuid)returns void
language plpgsql volatile security definer set search_path=''as $$
begin
 perform fyp_core_v2.role('coordinator');
 update fyp_security_v1.alerts set reviewed_at=now(),reviewed_by=auth.uid()where id=p_id and reviewed_at is null;
 if not found then raise exception 'Alert is unavailable or already reviewed'using errcode='40001';end if;
 insert into fyp_security_v1.events(event_key,actor,kind)values('review:'||p_id,auth.uid(),'alert_reviewed');
end$$;

revoke all on all functions in schema fyp_security_v1 from public,anon,authenticated,service_role;
revoke all on function public.fyp_security_context(),public.fyp_security_dashboard(),public.fyp_security_update(boolean,boolean,integer),public.fyp_security_review_alert(uuid)from public,anon;
grant execute on function public.fyp_security_context(),public.fyp_security_dashboard(),public.fyp_security_update(boolean,boolean,integer),public.fyp_security_review_alert(uuid)to authenticated;
notify pgrst,'reload schema';
commit;

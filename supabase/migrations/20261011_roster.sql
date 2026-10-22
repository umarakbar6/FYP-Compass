-- Coordinator-confirmed account invitations; no client-controlled profile writes.
begin;
create table if not exists fyp_ops_v1.invites(
 id uuid primary key default gen_random_uuid(),request_id uuid not null,
 actor uuid not null references public.fyp_profiles(id),session_id uuid not null references fyp_core_v2.sessions(id),
 email text not null,full_name text not null,role text not null check(role in ('student','supervisor','examiner')),
 status text not null default 'pending' check(status in ('pending','sent','failed','profile_pending')),
 auth_id uuid,created_at timestamptz not null default now(),unique(request_id,email));
alter table fyp_ops_v1.invites enable row level security;
revoke all on fyp_ops_v1.invites from public,anon,authenticated;
create index if not exists invites_actor_created on fyp_ops_v1.invites(actor,created_at);
create or replace function public.fyp_admin_invite_reserve(p_request_id uuid,p_session_id uuid,p_people jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person jsonb;count_rows integer;begin
 perform fyp_core_v2.role('coordinator');
 if p_request_id is null or p_session_id is null or not exists(select 1 from fyp_core_v2.sessions where id=p_session_id)
 or jsonb_typeof(p_people) is distinct from 'array' or jsonb_array_length(p_people) not between 1 and 20 then raise exception 'Invalid roster' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-invites-global-budget',0));
 perform pg_advisory_xact_lock(hashtextextended('fyp-invites:'||auth.uid()::text,0));
 if exists(select 1 from fyp_ops_v1.invites where request_id=p_request_id and actor<>auth.uid()) then raise exception 'Other invite batch' using errcode='42501';end if;
 if exists(select 1 from fyp_ops_v1.invites where request_id=p_request_id) then
 if (select jsonb_agg(jsonb_build_object('email',email,'full_name',full_name,'role',role) order by email) from fyp_ops_v1.invites where request_id=p_request_id)
 is distinct from (select jsonb_agg(value order by value->>'email') from jsonb_array_elements(p_people))
 or exists(select 1 from fyp_ops_v1.invites where request_id=p_request_id and session_id<>p_session_id) then raise exception 'Batch changed' using errcode='22023';end if;
 return (select jsonb_agg(to_jsonb(i) order by email) from fyp_ops_v1.invites i where request_id=p_request_id);end if;
 if (select count(*) from fyp_ops_v1.invites where created_at>now()-interval '1 hour')+jsonb_array_length(p_people)>30 then raise exception 'Invitation limit reached' using errcode='P0429';end if;
 select count(distinct lower(value->>'email')) into count_rows from jsonb_array_elements(p_people);
 if count_rows<>jsonb_array_length(p_people) then raise exception 'Duplicate emails' using errcode='22023';end if;
 for person in select value from jsonb_array_elements(p_people) loop
 if jsonb_typeof(person) is distinct from 'object' or person->>'role' is null or person->>'role' not in ('student','supervisor','examiner')
 or coalesce(person->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or length(coalesce(person->>'email',''))>254 or length(btrim(coalesce(person->>'full_name',''))) not between 2 and 120
 or (select count(*) from jsonb_object_keys(person))<>3 then raise exception 'Invalid roster row' using errcode='22023';end if;
 insert into fyp_ops_v1.invites(request_id,actor,session_id,email,full_name,role)
 values(p_request_id,auth.uid(),p_session_id,lower(person->>'email'),btrim(person->>'full_name'),person->>'role');
 end loop;
 return (select jsonb_agg(to_jsonb(i) order by email) from fyp_ops_v1.invites i where request_id=p_request_id);
end $$;
create or replace function public.fyp_admin_invite_finish(p_id uuid,p_actor uuid,p_auth_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare invitation fyp_ops_v1.invites;begin
 select * into invitation from fyp_ops_v1.invites where id=p_id for update;
 if invitation.id is null or invitation.actor<>p_actor or not exists(select 1 from public.fyp_profiles where id=p_actor and role='coordinator')
 or p_status not in ('sent','failed','profile_pending') then raise exception 'Invalid invitation result' using errcode='42501';end if;
 if invitation.status='sent' then return;end if;
 if p_status='sent' then
 if p_auth_id is null or not exists(select 1 from auth.users where id=p_auth_id) then raise exception 'Missing identity';end if;
 if exists(select 1 from public.fyp_profiles where id=p_auth_id) then raise exception 'Existing roles are never overwritten';end if;
 insert into public.fyp_profiles(id,full_name,role) values(p_auth_id,invitation.full_name,invitation.role);
 if invitation.role='student' then insert into fyp_core_v2.participants(profile_id,session_id) values(p_auth_id,invitation.session_id) on conflict do nothing;end if;
 end if;
 update fyp_ops_v1.invites set auth_id=p_auth_id,status=p_status where id=p_id;
 insert into fyp_core_v2.audit(actor,action,record_id,details) values(p_actor,'account_invitation',p_id::text,jsonb_build_object('role',invitation.role,'status',p_status));
end $$;
create or replace function public.fyp_admin_roster() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform fyp_core_v2.role('coordinator');
 return jsonb_build_object('actor_id',auth.uid(),'sessions',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from fyp_core_v2.sessions s),
 'people',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.fyp_profiles p),
 'invites',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from (select id,email,full_name,role,status,created_at from fyp_ops_v1.invites order by created_at desc limit 100)i));
end $$;
revoke all on function public.fyp_admin_invite_reserve(uuid,uuid,jsonb),public.fyp_admin_invite_finish(uuid,uuid,uuid,text),public.fyp_admin_roster() from public,anon,authenticated;
grant execute on function public.fyp_admin_invite_reserve(uuid,uuid,jsonb),public.fyp_admin_roster() to authenticated;
grant execute on function public.fyp_admin_invite_finish(uuid,uuid,uuid,text) to service_role;

alter table fyp_ops_v1.invites add column if not exists claimed_at timestamptz;
create or replace function public.fyp_admin_invite_claim(p_id uuid)returns boolean language plpgsql security definer set search_path=''as $$begin
 perform fyp_core_v2.role('coordinator');update fyp_ops_v1.invites set claimed_at=now()where id=p_id and actor=auth.uid()and status='pending'and claimed_at is null;return found;end $$;
revoke all on function public.fyp_admin_invite_claim(uuid)from public,anon;
grant execute on function public.fyp_admin_invite_claim(uuid)to authenticated;
commit;

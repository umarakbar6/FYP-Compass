-- An authenticated, auditable rights-request queue. No automatic destruction of academic records.
begin;
create schema if not exists fyp_privacy_v1;
revoke all on schema fyp_privacy_v1 from public,anon,authenticated;
create table fyp_privacy_v1.requests(
 id uuid primary key default gen_random_uuid(),actor uuid not null,
 kind text not null check(kind in ('export','correction','deletion')),
 detail text not null check(length(btrim(detail)) between 10 and 2000),
 status text not null default 'requested' check(status in ('requested','responded')),
 response text not null default '',version integer not null default 1,
 created_at timestamptz not null default now(),responded_at timestamptz,reviewed_by uuid
);
alter table fyp_privacy_v1.requests enable row level security;
revoke all on all tables in schema fyp_privacy_v1 from public,anon,authenticated;
create index privacy_actor_time on fyp_privacy_v1.requests(actor,created_at desc);
create unique index privacy_open_kind on fyp_privacy_v1.requests(actor,kind) where status='requested';
create or replace function public.fyp_privacy_requests() returns jsonb
language plpgsql security definer set search_path=''as $$
declare r text;begin
 r:=fyp_core_v2.role();
 return coalesce((select jsonb_agg(to_jsonb(q))from(
  select p.id,p.kind,p.detail,p.status,p.response,p.version,p.created_at,p.responded_at,
   coalesce(a.full_name,'Account no longer available')as requester_name,p.actor=auth.uid()as own_request
  from fyp_privacy_v1.requests p left join public.fyp_profiles a on a.id=p.actor
  where p.actor=auth.uid()or r='coordinator' order by p.created_at desc,p.id limit 100
 )q),'[]'::jsonb);
end$$;
create or replace function public.fyp_privacy_submit(p_kind text,p_detail text,p_confirm boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform fyp_core_v2.role();
 if p_confirm is distinct from true or p_kind is null or p_kind not in ('export','correction','deletion')
  or p_detail is null or length(btrim(p_detail)) not between 10 and 2000
 then raise exception 'Confirm a valid data request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('privacy:'||auth.uid()::text,0));
 if exists(select 1 from fyp_privacy_v1.requests where actor=auth.uid()and kind=p_kind and status='requested')
 then raise exception 'An open request of this type already exists' using errcode='22023';end if;
 if(select count(*)from fyp_privacy_v1.requests where actor=auth.uid()and created_at>now()-interval'24 hours')>=5
 then raise exception 'Data request limit reached' using errcode='P0429';end if;
 insert into fyp_privacy_v1.requests(actor,kind,detail)values(auth.uid(),p_kind,btrim(p_detail));
 return public.fyp_privacy_requests();
end$$;
create or replace function public.fyp_privacy_respond(p_id uuid,p_expected_version integer,p_response text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform fyp_core_v2.role('coordinator');
 if p_response is null or length(btrim(p_response))not between 10 and 2000
 then raise exception 'Record the response and any retention basis' using errcode='22023';end if;
 update fyp_privacy_v1.requests set response=btrim(p_response),status='responded',version=version+1,
  reviewed_by=auth.uid(),responded_at=now()
 where id=p_id and status='requested'and version=p_expected_version;
 if not found then raise exception 'Request changed. Refresh before responding.'using errcode='40001';end if;
 return public.fyp_privacy_requests();
end$$;
revoke all on function public.fyp_privacy_requests(),public.fyp_privacy_submit(text,text,boolean),public.fyp_privacy_respond(uuid,integer,text)from public,anon;
grant execute on function public.fyp_privacy_requests(),public.fyp_privacy_submit(text,text,boolean),public.fyp_privacy_respond(uuid,integer,text)to authenticated;
notify pgrst,'reload schema';
commit;

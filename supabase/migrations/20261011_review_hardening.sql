-- PDF review fixes: additive, preserves existing academic records.
begin;
create table if not exists fyp_ops_v1.client_events(
 reference uuid primary key, actor uuid not null references public.fyp_profiles(id),
 category text not null check(category='browser_render_failure'),
 created_at timestamptz not null default now());
alter table fyp_ops_v1.client_events enable row level security;
revoke all on fyp_ops_v1.client_events from public,anon,authenticated;
create index if not exists client_events_actor_time on fyp_ops_v1.client_events(actor,created_at);
create or replace function public.fyp_ops_record_client_error(p_category text,p_reference uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform fyp_core_v2.role();
 if p_category is distinct from 'browser_render_failure' or p_reference is null then raise exception 'Invalid event' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-events:'||auth.uid()::text,0));
 if (select count(*) from fyp_ops_v1.client_events where actor=auth.uid() and created_at>now()-interval '1 hour')>=10 then return;end if;
 insert into fyp_ops_v1.client_events(reference,actor,category) values(p_reference,auth.uid(),p_category) on conflict do nothing;
end $$;
create or replace function public.fyp_ops_client_events() returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform fyp_core_v2.role('coordinator');
 return (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') from
 (select reference,category,created_at from fyp_ops_v1.client_events order by created_at desc limit 50)e);
end $$;
revoke all on function public.fyp_ops_record_client_error(text,uuid),public.fyp_ops_client_events() from public,anon;
grant execute on function public.fyp_ops_record_client_error(text,uuid),public.fyp_ops_client_events() to authenticated;

-- Index referencing foreign-key columns where no existing leading index covers them.
do $$declare r record;cols text;idx text;begin
 for r in select c.conrelid,c.conkey,n.nspname,t.relname,c.conname
 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
 where c.contype='f' and n.nspname in ('fyp_core_v2','fyp_health_v2','fyp_assessment_v2','fyp_engagement_v1','fyp_ops_v1') loop
 if not exists(select 1 from pg_index i where i.indrelid=r.conrelid and i.indisvalid and i.indpred is null
 and (select array_agg(v order by ord) from unnest(i.indkey::smallint[]) with ordinality a(v,ord) where ord<=cardinality(r.conkey))=r.conkey) then
 select string_agg(quote_ident(a.attname),',' order by x.ord) into cols
 from unnest(r.conkey) with ordinality x(attnum,ord) join pg_attribute a on a.attrelid=r.conrelid and a.attnum=x.attnum;
 idx:='fyp_fk_'||substr(md5(r.nspname||r.relname||r.conname),1,20);
 execute format('create index if not exists %I on %I.%I (%s)',idx,r.nspname,r.relname,cols);
 end if;end loop;
end $$;
create index if not exists groups_session_lookup on fyp_core_v2.groups(session_id,id);
create index if not exists submissions_latest on fyp_core_v2.submissions(milestone_id,submitted_at desc,id desc);
create index if not exists enquiries_created_lookup on fyp_engagement_v1.enquiries(created_at desc,id desc);
create index if not exists enquiries_email_time on fyp_engagement_v1.enquiries(email,created_at desc);
create index if not exists reminders_recipient_time on fyp_engagement_v1.reminders(recipient,created_at desc);

-- Stable SQLSTATEs and a global abuse budget; idempotent retries are still checked first.
do $$declare definition text;begin
 select pg_get_functiondef('public.fyp_engagement_receive_enquiry(uuid,text,text,text,text,boolean,text)'::regprocedure) into definition;
 definition:=replace(definition,'raise exception ''Invalid enquiry'';','raise exception ''Invalid enquiry'' using errcode=''22023'';');
 definition:=replace(definition,'raise exception ''Retry key belongs to a different request'';','raise exception ''Retry key belongs to a different request'' using errcode=''22023'';');
 definition:=replace(definition,'if (select count(*) from fyp_engagement_v1.enquiries where abuse_hash=','if (select count(*) from fyp_engagement_v1.enquiries where created_at>now()-interval ''15 minutes'')>=30 or (select count(*) from fyp_engagement_v1.enquiries where abuse_hash=');
 definition:=replace(definition,'raise exception ''Too many enquiries. Please try again later.'';','raise exception ''Too many enquiries. Please try again later.'' using errcode=''P0429'';');
 execute definition;
end $$;
commit;

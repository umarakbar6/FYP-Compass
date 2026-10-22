
begin;
create or replace function public.fyp_enquiries_page(p_before_time timestamptz default null,p_before_id uuid default null,p_search text default '',p_status text default 'all',p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;total bigint;begin
 perform fyp_core_v2.role('coordinator');
 if p_limit is null or p_limit not between 1 and 50 or length(p_search)>200 or p_status not in ('all','new','contacted','in_progress','completed','spam')
 or (p_before_time is null)<>(p_before_id is null) then raise exception 'Invalid page' using errcode='22023';end if;
 select count(*) into total from fyp_engagement_v1.enquiries e where (p_status='all' or e.status=p_status)
 and position(lower(p_search) in lower(e.full_name||' '||e.email||' '||e.brief||' '||e.id::text))>0;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into rows from (
 select id,full_name,email,plan,brief,status,version,created_at from fyp_engagement_v1.enquiries e
 where (p_status='all' or e.status=p_status)
 and position(lower(p_search) in lower(e.full_name||' '||e.email||' '||e.brief||' '||e.id::text))>0
 and (p_before_time is null or (e.created_at,e.id)<(p_before_time,p_before_id))
 order by created_at desc,id desc limit p_limit+1)e;
 return jsonb_build_object('rows',(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(rows) with ordinality x(value,ord) where ord<=p_limit),
 'total',total,'has_more',jsonb_array_length(rows)>p_limit);
end $$;
revoke all on function public.fyp_enquiries_page(timestamptz,uuid,text,text,integer) from public,anon;
grant execute on function public.fyp_enquiries_page(timestamptz,uuid,text,text,integer) to authenticated;
-- The scheduler rechecks conflicts inside one transaction, independent of any AI output.
do $$declare definition text;begin
 select pg_get_functiondef('public.fyp_v2_schedule_defense(text,timestamptz,text,boolean,uuid,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'perform fyp_assessment_v2.coordinator();','perform fyp_assessment_v2.coordinator();perform pg_advisory_xact_lock(hashtextextended(''fyp-defense-calendar'',0));');
 definition:=replace(definition,'insert into fyp_assessment_v2.defenses(project_id,',
 'if exists(select 1 from fyp_assessment_v2.defenses d where d.scheduled_at<p_scheduled_at+interval ''1 hour'' and d.scheduled_at+interval ''1 hour''>p_scheduled_at and (lower(btrim(d.location))=lower(btrim(p_location)) or d.examiner_one in (p_examiner_one,p_examiner_two) or d.examiner_two in (p_examiner_one,p_examiner_two) or exists(select 1 from fyp_assessment_v2.certifications dc where dc.project_id=d.project_id and dc.supervisor=c.supervisor))) then raise exception ''Defense timetable conflict; choose a different room or time'' using errcode=''23514'';end if;insert into fyp_assessment_v2.defenses(project_id,');
 execute definition;
end $$;

create or replace function public.fyp_reports_page(p_session_id uuid default null,p_after_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;rows jsonb;total integer;begin
 perform fyp_core_v2.role('coordinator');
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid page size' using errcode='22023';end if;
 sid:=coalesce(p_session_id,(select id from fyp_core_v2.sessions where active));
 if sid is not null and not exists(select 1 from fyp_core_v2.sessions where id=sid)then raise exception 'Session unavailable' using errcode='22023';end if;
 select count(*) into total from fyp_core_v2.groups where session_id=sid;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'title',x.title,'proposal_status',x.proposal_status,'supervisor',x.supervisor,'milestones',x.milestones,'accepted',x.accepted) order by x.id),'[]') into rows from (
 select g.id,g.name,pr.title as title,pr.status::text as proposal_status,
 (select pr.full_name from fyp_core_v2.allocations a join public.fyp_profiles pr on pr.id=a.supervisor_id where a.group_id=g.id) as supervisor,
 (select count(*) from fyp_core_v2.milestones where group_id=g.id) as milestones,
 (select count(*) from fyp_core_v2.milestones where group_id=g.id and status='accepted') as accepted
 from fyp_core_v2.groups g left join lateral (select p.title,p.status from fyp_core_v2.proposals p where p.group_id=g.id order by (p.status in ('draft','submitted','changes_requested','approved')) desc,p.submitted_at desc nulls last,p.id desc limit 1) pr on true where g.session_id=sid and (p_after_id is null or g.id>p_after_id) order by g.id limit p_limit)x;
 return jsonb_build_object('session_id',sid,'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]')from fyp_core_v2.sessions s),
 'rows',rows,'total',total,'has_more',exists(select 1 from fyp_core_v2.groups where session_id=sid and id>coalesce((rows->(jsonb_array_length(rows)-1)->>'id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)),
 'sql_totals',jsonb_build_object('groups',total,'allocated',(select count(*) from fyp_core_v2.allocations a join fyp_core_v2.groups g on g.id=a.group_id where g.session_id=sid),
 'milestones',(select count(*) from fyp_core_v2.milestones m join fyp_core_v2.groups g on g.id=m.group_id where g.session_id=sid),
 'accepted_milestones',(select count(*) from fyp_core_v2.milestones m join fyp_core_v2.groups g on g.id=m.group_id where g.session_id=sid and m.status='accepted'),
 'defenses',(select count(*) from fyp_assessment_v2.defenses d join fyp_core_v2.groups g on g.id::text=d.project_id where g.session_id=sid),
 'released_results',(select count(*) from fyp_assessment_v2.results rr join fyp_assessment_v2.defenses d on d.id=rr.defense_id join fyp_core_v2.groups g on g.id::text=d.project_id where g.session_id=sid and rr.released_at is not null)));
end $$;
revoke all on function public.fyp_reports_page(uuid,uuid,integer) from public,anon;
grant execute on function public.fyp_reports_page(uuid,uuid,integer) to authenticated;

create table if not exists fyp_ops_v1.availability(id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.fyp_profiles(id),starts_at timestamptz not null,ends_at timestamptz not null,created_by uuid not null references public.fyp_profiles(id),check(ends_at>starts_at),unique(profile_id,starts_at,ends_at));
alter table fyp_ops_v1.availability enable row level security;
revoke all on fyp_ops_v1.availability from public,anon,authenticated;
create index if not exists availability_creator on fyp_ops_v1.availability(created_by);
create index if not exists availability_person_time on fyp_ops_v1.availability(profile_id,starts_at,ends_at);
create or replace function public.fyp_schedule_availability_workspace() returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fyp_core_v2.role('coordinator');return jsonb_build_object('people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role) order by full_name),'[]') from public.fyp_profiles where role in ('examiner','supervisor')),
 'windows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from (select id,profile_id,starts_at,ends_at from fyp_ops_v1.availability where ends_at>now() order by starts_at limit 500)x));end $$;
create or replace function public.fyp_schedule_availability(p_profile_id uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fyp_core_v2.role('coordinator');
 if p_start is null or p_end is null or p_start<now() or p_end<=p_start or p_end>p_start+interval '24 hours'
 or p_start>now()+interval '6 months' or not exists(select 1 from public.fyp_profiles where id=p_profile_id and role in ('supervisor','examiner')) then raise exception 'Supply a future availability window of up to 24 hours for a supervisor or examiner' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-schedule-availability',0));
 if(select count(*)from fyp_ops_v1.availability where ends_at>now())>=500 then raise exception 'Availability window limit reached' using errcode='P0429';end if;
 insert into fyp_ops_v1.availability(profile_id,starts_at,ends_at,created_by)values(p_profile_id,p_start,p_end,auth.uid())on conflict(profile_id,starts_at,ends_at)do nothing;
 return public.fyp_schedule_availability_workspace();end $$;
create or replace function public.fyp_schedule_remove_availability(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fyp_core_v2.role('coordinator');delete from fyp_ops_v1.availability where id=p_id;return public.fyp_schedule_availability_workspace();end $$;
revoke all on function public.fyp_schedule_availability_workspace(),public.fyp_schedule_availability(uuid,timestamptz,timestamptz),public.fyp_schedule_remove_availability(uuid) from public,anon;
grant execute on function public.fyp_schedule_availability_workspace(),public.fyp_schedule_availability(uuid,timestamptz,timestamptz),public.fyp_schedule_remove_availability(uuid) to authenticated;
commit;

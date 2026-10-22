-- Project governance: versioned assessment rubrics, supervision meetings and feedback resolution.
begin;
create schema if not exists fyp_governance_v1;
revoke all on schema fyp_governance_v1 from public,anon,authenticated;

create table if not exists fyp_governance_v1.rubrics(
 id uuid primary key default gen_random_uuid(), version integer not null unique,
 name text not null check(length(btrim(name)) between 3 and 120),
 description text not null default '' check(length(description)<=2000), criteria jsonb not null,
 active boolean not null default false, created_by uuid references public.fyp_profiles(id),
 created_at timestamptz not null default now()
);
create unique index if not exists fyp_governance_one_active_rubric on fyp_governance_v1.rubrics(active) where active;
create table if not exists fyp_governance_v1.meetings(
 id uuid primary key default gen_random_uuid(), group_id uuid not null references fyp_core_v2.groups(id),
 starts_at timestamptz not null, duration_minutes integer not null check(duration_minutes between 15 and 240),
 location text not null check(length(btrim(location)) between 2 and 240), agenda text not null check(length(btrim(agenda)) between 3 and 4000),
 status text not null check(status in ('requested','scheduled','completed','cancelled')),
 minutes text, decisions jsonb not null default '[]', action_items jsonb not null default '[]',
 created_by uuid not null references public.fyp_profiles(id), updated_by uuid not null references public.fyp_profiles(id),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(minutes is null or length(btrim(minutes)) between 3 and 12000),
 check(jsonb_typeof(decisions)='array' and jsonb_typeof(action_items)='array')
);
create index if not exists fyp_governance_meeting_group_time on fyp_governance_v1.meetings(group_id,starts_at desc);
create table if not exists fyp_governance_v1.feedback_items(
 id uuid primary key default gen_random_uuid(), group_id uuid not null references fyp_core_v2.groups(id),
 source_type text not null check(source_type in ('proposal','milestone','meeting','general')), source_id text not null,
 title text not null check(length(btrim(title)) between 3 and 180), details text not null check(length(btrim(details)) between 3 and 6000),
 status text not null default 'open' check(status in ('open','addressed','verified','reopened')),
 student_response text, created_by uuid not null references public.fyp_profiles(id), responded_by uuid references public.fyp_profiles(id),
 verified_by uuid references public.fyp_profiles(id), version integer not null default 1,
 created_at timestamptz not null default now(), responded_at timestamptz, verified_at timestamptz, updated_at timestamptz not null default now(),
 unique(group_id,source_type,source_id), check(student_response is null or length(btrim(student_response)) between 3 and 6000)
);
create index if not exists fyp_governance_feedback_group_status on fyp_governance_v1.feedback_items(group_id,status,created_at desc);
create table if not exists fyp_governance_v1.audit(
 id bigint generated always as identity primary key, actor uuid not null, action text not null,
 record_id text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
do $$declare t text;begin foreach t in array array['rubrics','meetings','feedback_items','audit'] loop execute format('alter table fyp_governance_v1.%I enable row level security',t);end loop;end$$;
revoke all on all tables in schema fyp_governance_v1 from public,anon,authenticated;
revoke all on all sequences in schema fyp_governance_v1 from public,anon,authenticated;

create or replace function fyp_governance_v1.authorize_group(p_group uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare r text;begin r:=fyp_core_v2.role();
 if r='coordinator' then return r;end if;
 if r='student' and exists(select 1 from fyp_core_v2.members where group_id=p_group and student_id=auth.uid()) then return r;end if;
 if r='supervisor' and exists(select 1 from fyp_core_v2.allocations where group_id=p_group and supervisor_id=auth.uid()) then return r;end if;
 raise exception 'Project governance record is unavailable' using errcode='42501';
end$$;

create or replace function fyp_governance_v1.validate_rubric(p_criteria jsonb) returns void language plpgsql immutable set search_path='' as $$
declare component text;cap numeric;total numeric;begin
 if jsonb_typeof(p_criteria) is distinct from 'array' or jsonb_array_length(p_criteria) not between 6 and 30 then raise exception 'Rubric requires 6 to 30 criteria';end if;
 if exists(select 1 from jsonb_array_elements(p_criteria) c where jsonb_typeof(c)<>'object' or c->>'id' is null or c->>'id' !~ '^[a-z0-9_]{2,40}$' or c->>'component' not in ('proposal','progress','contribution','report','implementation','viva') or length(btrim(c->>'label')) not between 3 and 120 or length(coalesce(c->>'guidance',''))>1000 or jsonb_typeof(c->'points')<>'number' or (c->>'points')::numeric<=0 or (c->>'points')::numeric<>round((c->>'points')::numeric,2)) then raise exception 'Each rubric criterion needs a valid id, component, label and points';end if;
 if (select count(*) from jsonb_array_elements(p_criteria))<>(select count(distinct c->>'id') from jsonb_array_elements(p_criteria)c) then raise exception 'Rubric criterion ids must be unique';end if;
 for component,cap in select * from (values('proposal',10::numeric),('progress',15),('contribution',15),('report',15),('implementation',15),('viva',20))v loop
  select coalesce(sum((c->>'points')::numeric),0) into total from jsonb_array_elements(p_criteria)c where c->>'component'=component;
  if total<>cap then raise exception '% criteria must total % points',component,cap;end if;
 end loop;
end$$;

insert into fyp_governance_v1.rubrics(version,name,description,criteria,active,created_by)
select 1,'Standard FYP assessment','The approved 55 mark group and 45 mark individual assessment structure.',
'[{"id":"proposal_quality","component":"proposal","label":"Proposal quality","guidance":"Clarity, relevance and feasibility of the approved proposal.","points":10},{"id":"progress_evidence","component":"progress","label":"Progress and documentation","guidance":"Milestone completion, documentation quality and response to supervision.","points":15},{"id":"individual_contribution","component":"contribution","label":"Individual contribution","guidance":"Evidence of the student own contribution to the project.","points":15},{"id":"report_quality","component":"report","label":"Final report","guidance":"Academic writing, structure, evidence and technical accuracy.","points":15},{"id":"implementation_quality","component":"implementation","label":"Implementation and demonstration","guidance":"Functionality, engineering quality and demonstration evidence.","points":15},{"id":"viva_performance","component":"viva","label":"Viva performance","guidance":"Understanding, explanation and defense of individual work.","points":20}]'::jsonb,true,(select id from public.fyp_profiles where role::text='coordinator' order by id limit 1)
where not exists(select 1 from fyp_governance_v1.rubrics);

create or replace function public.fyp_governance_workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;groups uuid[];begin r:=fyp_core_v2.role();
 if r='student' then select coalesce(array_agg(group_id),'{}') into groups from fyp_core_v2.members where student_id=auth.uid();
 elsif r='supervisor' then select coalesce(array_agg(group_id),'{}') into groups from fyp_core_v2.allocations where supervisor_id=auth.uid();
 elsif r='coordinator' then select coalesce(array_agg(id),'{}') into groups from fyp_core_v2.groups;
 else raise exception 'Project governance is available to students, supervisors and coordinators' using errcode='42501';end if;
 return jsonb_build_object('actor_id',auth.uid(),'role',r,
  'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'title',coalesce((fyp_core_v2.proposal(g.id)).title,g.name),'members',fyp_core_v2.members(g.id),'supervisor_id',a.supervisor_id) order by g.name),'[]') from fyp_core_v2.groups g left join fyp_core_v2.allocations a on a.group_id=g.id where g.id=any(groups)),
  'active_rubric',(select to_jsonb(x) from (select id,version,name,description,criteria,created_at from fyp_governance_v1.rubrics where active)x),
  'rubrics',case when r='coordinator' then (select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') from (select id,version,name,description,criteria,active,created_at from fyp_governance_v1.rubrics)x) else '[]'::jsonb end,
  'meetings',(select coalesce(jsonb_agg(to_jsonb(m) order by starts_at desc),'[]') from fyp_governance_v1.meetings m where group_id=any(groups)),
  'feedback',(select coalesce(jsonb_agg(to_jsonb(f) order by created_at desc),'[]') from fyp_governance_v1.feedback_items f where group_id=any(groups)));
end$$;

create or replace function public.fyp_governance_active_rubric() returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fyp_core_v2.role();
 return (select to_jsonb(x) from (select id,version,name,description,criteria,created_at from fyp_governance_v1.rubrics where active)x);
end$$;

create or replace function public.fyp_governance_save_rubric(p_name text,p_description text,p_criteria jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare next_version integer;rid uuid;begin perform fyp_core_v2.role('coordinator');perform fyp_governance_v1.validate_rubric(p_criteria);
 if length(btrim(coalesce(p_name,''))) not between 3 and 120 or length(coalesce(p_description,''))>2000 then raise exception 'A valid rubric name and description are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-governance-rubric',0));select coalesce(max(version),0)+1 into next_version from fyp_governance_v1.rubrics;
 if exists(select 1 from fyp_assessment_v2.defenses d where (select count(*) from fyp_assessment_v2.assessments a where a.defense_id=d.id) between 1 and 1) then raise exception 'Finish both examiner assessments before activating a new rubric';end if;
 update fyp_governance_v1.rubrics set active=false where active;
 insert into fyp_governance_v1.rubrics(version,name,description,criteria,active,created_by) values(next_version,btrim(p_name),btrim(coalesce(p_description,'')),p_criteria,true,auth.uid()) returning id into rid;
 insert into fyp_governance_v1.audit(actor,action,record_id,details) values(auth.uid(),'rubric_activated',rid::text,jsonb_build_object('version',next_version,'name',btrim(p_name)));
 return public.fyp_governance_workspace();end$$;

create or replace function public.fyp_governance_book_meeting(p_group_id uuid,p_starts_at timestamptz,p_duration integer,p_location text,p_agenda text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;mid uuid;begin r:=fyp_governance_v1.authorize_group(p_group_id);
 if r not in ('student','supervisor') then raise exception 'Students and supervisors can book meetings' using errcode='42501';end if;
 if p_starts_at is null or p_starts_at<now()+interval '5 minutes' or p_starts_at>now()+interval '365 days' or p_duration not between 15 and 240 or length(btrim(coalesce(p_location,''))) not between 2 and 240 or length(btrim(coalesce(p_agenda,''))) not between 3 and 4000 then raise exception 'Enter a future time, duration, location and agenda';end if;
 if exists(select 1 from fyp_governance_v1.meetings where group_id=p_group_id and status in ('requested','scheduled') and tstzrange(starts_at,starts_at+duration_minutes*interval '1 minute','[)') && tstzrange(p_starts_at,p_starts_at+p_duration*interval '1 minute','[)')) then raise exception 'This project already has an overlapping meeting';end if;
 insert into fyp_governance_v1.meetings(group_id,starts_at,duration_minutes,location,agenda,status,created_by,updated_by) values(p_group_id,p_starts_at,p_duration,btrim(p_location),btrim(p_agenda),case when r='student' then 'requested' else 'scheduled' end,auth.uid(),auth.uid()) returning id into mid;
 insert into fyp_governance_v1.audit(actor,action,record_id,details) values(auth.uid(),'meeting_booked',mid::text,jsonb_build_object('status',case when r='student' then 'requested' else 'scheduled' end));return public.fyp_governance_workspace();end$$;

create or replace function public.fyp_governance_update_meeting(p_id uuid,p_expected_version integer,p_action text,p_starts_at timestamptz default null,p_location text default null,p_minutes text default null,p_decisions jsonb default '[]',p_action_items jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $$
declare m fyp_governance_v1.meetings;r text;target_time timestamptz;begin select * into m from fyp_governance_v1.meetings where id=p_id for update;if m.id is null then raise exception 'Meeting unavailable';end if;r:=fyp_governance_v1.authorize_group(m.group_id);target_time:=coalesce(p_starts_at,m.starts_at);
 if m.version<>p_expected_version then raise exception 'Meeting changed; refresh and try again' using errcode='40001';end if;
 if jsonb_typeof(coalesce(p_decisions,'[]'))<>'array' or jsonb_typeof(coalesce(p_action_items,'[]'))<>'array' or exists(select 1 from jsonb_array_elements(coalesce(p_decisions,'[]'))x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 500) or exists(select 1 from jsonb_array_elements(coalesce(p_action_items,'[]'))x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 500) then raise exception 'Decisions and action items must be short nonempty text entries';end if;
 if r='student' then if p_action<>'cancel' or m.created_by<>auth.uid() or m.status<>'requested' then raise exception 'Students can cancel only their own pending request' using errcode='42501';end if;update fyp_governance_v1.meetings set status='cancelled',updated_by=auth.uid(),updated_at=now(),version=version+1 where id=m.id;
 elsif r='supervisor' then
  if p_action in ('confirm','reschedule') and (target_time<now()+interval '5 minutes' or target_time>now()+interval '365 days' or exists(select 1 from fyp_governance_v1.meetings other where other.id<>m.id and other.group_id=m.group_id and other.status in ('requested','scheduled') and tstzrange(other.starts_at,other.starts_at+other.duration_minutes*interval '1 minute','[)') && tstzrange(target_time,target_time+m.duration_minutes*interval '1 minute','[)'))) then raise exception 'Choose a future time that does not overlap another project meeting';end if;
  if p_action='confirm' and m.status='requested' then update fyp_governance_v1.meetings set status='scheduled',starts_at=coalesce(p_starts_at,starts_at),location=coalesce(nullif(btrim(p_location),''),location),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=m.id;
  elsif p_action='reschedule' and m.status in ('requested','scheduled') and p_starts_at>now()+interval '5 minutes' then update fyp_governance_v1.meetings set status='scheduled',starts_at=p_starts_at,location=coalesce(nullif(btrim(p_location),''),location),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=m.id;
  elsif p_action='complete' and m.status='scheduled' and length(btrim(coalesce(p_minutes,''))) between 3 and 12000 then update fyp_governance_v1.meetings set status='completed',minutes=btrim(p_minutes),decisions=coalesce(p_decisions,'[]'),action_items=coalesce(p_action_items,'[]'),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=m.id;
  elsif p_action='cancel' and m.status in ('requested','scheduled') then update fyp_governance_v1.meetings set status='cancelled',updated_by=auth.uid(),updated_at=now(),version=version+1 where id=m.id;
  else raise exception 'Meeting action is unavailable or incomplete';end if;
 else raise exception 'Coordinator has read only meeting access' using errcode='42501';end if;
 insert into fyp_governance_v1.audit(actor,action,record_id,details) values(auth.uid(),'meeting_'||p_action,m.id::text,jsonb_build_object('previous_status',m.status));return public.fyp_governance_workspace();end$$;

create or replace function public.fyp_governance_create_feedback(p_group_id uuid,p_source_type text,p_source_id text,p_title text,p_details text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;fid uuid;begin r:=fyp_governance_v1.authorize_group(p_group_id);if r<>'supervisor' then raise exception 'Assigned supervisor required' using errcode='42501';end if;
 if p_source_type not in ('meeting','general') or length(btrim(coalesce(p_source_id,''))) not between 1 and 120 or length(btrim(coalesce(p_title,''))) not between 3 and 180 or length(btrim(coalesce(p_details,''))) not between 3 and 6000 then raise exception 'Complete the feedback source, title and details';end if;
 insert into fyp_governance_v1.feedback_items(group_id,source_type,source_id,title,details,created_by) values(p_group_id,p_source_type,btrim(p_source_id),btrim(p_title),btrim(p_details),auth.uid()) returning id into fid;
 insert into fyp_governance_v1.audit(actor,action,record_id,details) values(auth.uid(),'feedback_created',fid::text,jsonb_build_object('group_id',p_group_id));return public.fyp_governance_workspace();end$$;

create or replace function public.fyp_governance_respond_feedback(p_id uuid,p_expected_version integer,p_response text) returns jsonb language plpgsql security definer set search_path='' as $$
declare f fyp_governance_v1.feedback_items;r text;begin select * into f from fyp_governance_v1.feedback_items where id=p_id for update;if f.id is null then raise exception 'Feedback unavailable';end if;r:=fyp_governance_v1.authorize_group(f.group_id);if r<>'student' then raise exception 'Project student required' using errcode='42501';end if;if f.version<>p_expected_version then raise exception 'Feedback changed; refresh and try again' using errcode='40001';end if;if f.status not in ('open','reopened') or length(btrim(coalesce(p_response,''))) not between 3 and 6000 then raise exception 'An open feedback item and a clear response are required';end if;
 update fyp_governance_v1.feedback_items set status='addressed',student_response=btrim(p_response),responded_by=auth.uid(),responded_at=now(),verified_by=null,verified_at=null,updated_at=now(),version=version+1 where id=f.id;
 insert into fyp_governance_v1.audit(actor,action,record_id,details) values(auth.uid(),'feedback_addressed',f.id::text,'{}');return public.fyp_governance_workspace();end$$;

create or replace function public.fyp_governance_review_feedback(p_id uuid,p_expected_version integer,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare f fyp_governance_v1.feedback_items;r text;begin select * into f from fyp_governance_v1.feedback_items where id=p_id for update;if f.id is null then raise exception 'Feedback unavailable';end if;r:=fyp_governance_v1.authorize_group(f.group_id);if r<>'supervisor' then raise exception 'Assigned supervisor required' using errcode='42501';end if;if f.version<>p_expected_version then raise exception 'Feedback changed; refresh and try again' using errcode='40001';end if;
 if p_action='verify' and f.status='addressed' then update fyp_governance_v1.feedback_items set status='verified',verified_by=auth.uid(),verified_at=now(),updated_at=now(),version=version+1 where id=f.id;
 elsif p_action='reopen' and f.status in ('addressed','verified') then update fyp_governance_v1.feedback_items set status='reopened',verified_by=null,verified_at=null,updated_at=now(),version=version+1 where id=f.id;
 else raise exception 'Feedback action is unavailable';end if;
 insert into fyp_governance_v1.audit(actor,action,record_id,details) values(auth.uid(),'feedback_'||p_action,f.id::text,'{}');return public.fyp_governance_workspace();end$$;

create or replace function fyp_governance_v1.capture_review_feedback() returns trigger language plpgsql security definer set search_path='' as $$
declare gid uuid;reviewer uuid;kind text;source text;heading text;body text;begin
 if tg_table_name='proposals' then gid:=new.group_id;reviewer:=nullif(new.review->>'reviewer_id','')::uuid;kind:='proposal';source:=new.id::text;heading:='Proposal review feedback';body:=new.feedback;
 else select group_id into gid from fyp_core_v2.milestones where id=new.milestone_id;reviewer:=nullif(new.review->>'reviewer_id','')::uuid;kind:='milestone';source:=new.id::text;heading:='Milestone review feedback';body:=new.review->>'feedback';end if;
 if gid is not null and reviewer is not null and length(btrim(coalesce(body,'')))>=3 then insert into fyp_governance_v1.feedback_items(group_id,source_type,source_id,title,details,created_by) values(gid,kind,source,heading,btrim(body),reviewer) on conflict(group_id,source_type,source_id) do update set details=excluded.details,status='open',student_response=null,responded_by=null,responded_at=null,verified_by=null,verified_at=null,updated_at=now(),version=fyp_governance_v1.feedback_items.version+1;end if;return new;end$$;
drop trigger if exists fyp_governance_proposal_feedback on fyp_core_v2.proposals;
create trigger fyp_governance_proposal_feedback after insert or update of feedback,review on fyp_core_v2.proposals for each row execute function fyp_governance_v1.capture_review_feedback();
drop trigger if exists fyp_governance_milestone_feedback on fyp_core_v2.submissions;
create trigger fyp_governance_milestone_feedback after insert or update of review on fyp_core_v2.submissions for each row execute function fyp_governance_v1.capture_review_feedback();

insert into fyp_governance_v1.feedback_items(group_id,source_type,source_id,title,details,created_by)
select p.group_id,'proposal',p.id::text,'Proposal review feedback',btrim(p.feedback),(p.review->>'reviewer_id')::uuid from fyp_core_v2.proposals p join public.fyp_profiles reviewer on reviewer.id=nullif(p.review->>'reviewer_id','')::uuid where length(btrim(coalesce(p.feedback,'')))>=3
on conflict(group_id,source_type,source_id)do nothing;
insert into fyp_governance_v1.feedback_items(group_id,source_type,source_id,title,details,created_by)
select m.group_id,'milestone',s.id::text,'Milestone review feedback',btrim(s.review->>'feedback'),(s.review->>'reviewer_id')::uuid from fyp_core_v2.submissions s join fyp_core_v2.milestones m on m.id=s.milestone_id join public.fyp_profiles reviewer on reviewer.id=nullif(s.review->>'reviewer_id','')::uuid where length(btrim(coalesce(s.review->>'feedback','')))>=3
on conflict(group_id,source_type,source_id)do nothing;

alter table fyp_assessment_v2.supervisor_marks add column if not exists rubric_id uuid references fyp_governance_v1.rubrics(id),add column if not exists rubric_snapshot jsonb,add column if not exists rubric_scores jsonb;
alter table fyp_assessment_v2.assessments add column if not exists rubric_id uuid references fyp_governance_v1.rubrics(id),add column if not exists rubric_snapshot jsonb,add column if not exists rubric_scores jsonb;
create or replace function fyp_governance_v1.score(p_rubric jsonb,p_component text,p_scores jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare criteria jsonb;total numeric;begin select coalesce(jsonb_agg(c),'[]') into criteria from jsonb_array_elements(p_rubric->'criteria')c where c->>'component'=p_component;
 if jsonb_typeof(p_scores)<>'object' or (select count(*) from jsonb_object_keys(p_scores))<>jsonb_array_length(criteria) or exists(select 1 from jsonb_array_elements(criteria)c where not(p_scores ? (c->>'id')) or jsonb_typeof(p_scores->(c->>'id'))<>'number' or (p_scores->>(c->>'id'))::numeric<0 or (p_scores->>(c->>'id'))::numeric>(c->>'points')::numeric or (p_scores->>(c->>'id'))::numeric<>round((p_scores->>(c->>'id'))::numeric,2)) or exists(select 1 from jsonb_object_keys(p_scores)k where not exists(select 1 from jsonb_array_elements(criteria)c where c->>'id'=k)) then raise exception 'Complete every % rubric criterion within its maximum',p_component;end if;
 select coalesce(sum(value::text::numeric),0) into total from jsonb_each(p_scores);return total;end$$;

create or replace function public.fyp_governance_save_supervisor_marks(p_project_id text,p_scores jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rubric fyp_governance_v1.rubrics;p jsonb;member jsonb;individual jsonb:='[]';proposal numeric;progress numeric;contribution numeric;begin perform pg_advisory_xact_lock(hashtextextended('fyp-governance-rubric',0));select * into rubric from fyp_governance_v1.rubrics where active;if rubric.id is null then raise exception 'Active rubric unavailable';end if;p:=fyp_health_v2.project(p_project_id,true);
 proposal:=fyp_governance_v1.score(to_jsonb(rubric),'proposal',p_scores->'proposal');progress:=fyp_governance_v1.score(to_jsonb(rubric),'progress',p_scores->'progress');
 for member in select value from jsonb_array_elements(p->'members') loop contribution:=fyp_governance_v1.score(to_jsonb(rubric),'contribution',p_scores->'contribution'->(member->>'id'));individual:=individual||jsonb_build_array(jsonb_build_object('student_id',member->>'id','mark',contribution));end loop;
 perform public.fyp_v2_save_supervisor_marks(p_project_id,proposal,progress,individual);update fyp_assessment_v2.supervisor_marks set rubric_id=rubric.id,rubric_snapshot=to_jsonb(rubric)-'created_by',rubric_scores=p_scores where project_id=p_project_id;return public.fyp_v2_assessment_workspace();end$$;
create or replace function public.fyp_governance_submit_examiner_marks(p_defense_id uuid,p_scores jsonb,p_comments text) returns jsonb language plpgsql security definer set search_path='' as $$
declare rubric fyp_governance_v1.rubrics;d fyp_assessment_v2.defenses;member jsonb;viva jsonb:='[]';report numeric;implementation numeric;mark numeric;begin perform pg_advisory_xact_lock(hashtextextended('fyp-governance-rubric',0));select * into rubric from fyp_governance_v1.rubrics where active;if rubric.id is null then raise exception 'Active rubric unavailable';end if;select * into d from fyp_assessment_v2.defenses where id=p_defense_id;
 report:=fyp_governance_v1.score(to_jsonb(rubric),'report',p_scores->'report');implementation:=fyp_governance_v1.score(to_jsonb(rubric),'implementation',p_scores->'implementation');
 for member in select value from jsonb_array_elements(d.project->'members') loop mark:=fyp_governance_v1.score(to_jsonb(rubric),'viva',p_scores->'viva'->(member->>'id'));viva:=viva||jsonb_build_array(jsonb_build_object('student_id',member->>'id','mark',mark));end loop;
 perform public.fyp_v2_submit_examiner_marks(p_defense_id,report,implementation,viva,p_comments);update fyp_assessment_v2.assessments set rubric_id=rubric.id,rubric_snapshot=to_jsonb(rubric)-'created_by',rubric_scores=p_scores where defense_id=p_defense_id and examiner=auth.uid();return public.fyp_v2_assessment_workspace();end$$;

revoke all on all functions in schema fyp_governance_v1 from public,anon,authenticated;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fyp_governance_%' loop execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end$$;
notify pgrst,'reload schema';
commit;

-- GENERATED from canonical supabase/migrations. Do not hand-edit.
-- Fresh installation ONLY; never replay foundations on an existing live database.
begin;
-- SOURCE: supabase/migrations/202610080001_00_profiles.sql
-- Role profiles may only be assigned by an administrator, never by the browser.

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


-- SOURCE: supabase/migrations/202610080002_core_v2.sql
-- Complete independent FYP core. Existing legacy records/functions are retained.
-- Select VITE_BACKEND_API=v2 after installing core, health and assessment migrations.

do $$begin
if to_regclass('public.fyp_profiles') is null then raise exception 'Auth profile contract is required';end if;
if exists(select 1 from pg_namespace where nspname='fyp_core_v2') then raise exception 'Core v2 already installed';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fyp_v2_core_%') then raise exception 'A core target RPC already exists';end if;
end $$;
create schema fyp_core_v2;revoke all on schema fyp_core_v2 from public,anon,authenticated;
create table fyp_core_v2.sessions(id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 100),active boolean not null default false);
create unique index one_active_session on fyp_core_v2.sessions(active) where active;
create table fyp_core_v2.topics(id uuid primary key default gen_random_uuid(),name text not null unique check(length(btrim(name)) between 1 and 80));
create table fyp_core_v2.participants(profile_id uuid not null references public.fyp_profiles(id),session_id uuid not null references fyp_core_v2.sessions(id),primary key(profile_id,session_id));
create table fyp_core_v2.capacities(session_id uuid not null references fyp_core_v2.sessions(id),supervisor_id uuid not null references public.fyp_profiles(id),max_groups integer not null check(max_groups between 0 and 100),topic_ids uuid[] not null default '{}',primary key(session_id,supervisor_id));
create table fyp_core_v2.templates(id uuid primary key default gen_random_uuid(),session_id uuid not null references fyp_core_v2.sessions(id),name text not null,description text not null default '',days integer not null check(days between 1 and 365),unique(session_id,name));
create table fyp_core_v2.groups(id uuid primary key default gen_random_uuid(),session_id uuid not null references fyp_core_v2.sessions(id),name text not null check(length(btrim(name)) between 1 and 100));
create table fyp_core_v2.members(group_id uuid not null references fyp_core_v2.groups(id),student_id uuid not null references public.fyp_profiles(id),primary key(group_id,student_id));
create table fyp_core_v2.proposals(id uuid primary key default gen_random_uuid(),group_id uuid not null references fyp_core_v2.groups(id),title text not null,abstract text not null,keywords text[] not null,topic_ids uuid[] not null,supervisor_ids uuid[] not null,status text not null check(status in ('draft','submitted','changes_requested','approved','rejected','withdrawn')),document jsonb,submitted_at timestamptz,feedback text,review jsonb,started_at timestamptz,similarity jsonb not null default '{"percentage":null,"closest_title":null,"status":"pending"}');
create unique index one_active_proposal on fyp_core_v2.proposals(group_id) where status in ('draft','submitted','changes_requested','approved');
create table fyp_core_v2.allocations(group_id uuid primary key references fyp_core_v2.groups(id),supervisor_id uuid not null references public.fyp_profiles(id),preference_rank integer check(preference_rank between 1 and 3),explanation text not null,seed text,created_at timestamptz not null default now());
create table fyp_core_v2.milestones(id uuid primary key default gen_random_uuid(),group_id uuid not null references fyp_core_v2.groups(id),name text not null,description text not null,deadline timestamptz not null,status text not null default 'not_started' check(status in ('not_started','submitted','needs_rework','accepted')),unique(group_id,name));
create table fyp_core_v2.submissions(id uuid primary key default gen_random_uuid(),milestone_id uuid not null references fyp_core_v2.milestones(id),submitted_by uuid not null,submitted_at timestamptz not null default now(),document jsonb not null,review jsonb);
create table fyp_core_v2.statements(submission_id uuid not null references fyp_core_v2.submissions(id),student_id uuid not null,statement text not null check(length(btrim(statement)) between 1 and 4000),updated_at timestamptz not null default now(),primary key(submission_id,student_id));
create table fyp_core_v2.audit(id bigint generated always as identity primary key,actor uuid not null,action text not null,record_id text not null,details jsonb not null,created_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['sessions','topics','participants','capacities','templates','groups','members','proposals','allocations','milestones','submissions','statements','audit'] loop execute format('alter table fyp_core_v2.%I enable row level security',t);end loop;end $$;
revoke all on all tables in schema fyp_core_v2 from public,anon,authenticated;revoke all on all sequences in schema fyp_core_v2 from public,anon,authenticated;
create function fyp_core_v2.role(expected text default null) returns text language plpgsql stable security definer set search_path='' as $$declare r text;begin select role::text into r from public.fyp_profiles where id=auth.uid();if auth.uid() is null or r is null or (expected is not null and r<>expected) then raise exception 'Role is not permitted' using errcode='42501';end if;return r;end $$;
create function fyp_core_v2.lock() returns void language sql set search_path='' as $$select pg_advisory_xact_lock(hashtextextended('fyp-core-v2',0))$$;
create function fyp_core_v2.members(g uuid) returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'role','student') order by p.id),'[]') from fyp_core_v2.members m join public.fyp_profiles p on p.id=m.student_id where m.group_id=g$$;
create function fyp_core_v2.proposal(g uuid) returns fyp_core_v2.proposals language sql stable security definer set search_path='' as $$select p from fyp_core_v2.proposals p where group_id=g order by (status in ('draft','submitted','changes_requested','approved')) desc,submitted_at desc nulls last,id desc limit 1$$;
create function fyp_core_v2.visible_proposal(g uuid) returns fyp_core_v2.proposals language sql stable security definer set search_path='' as $$select p from fyp_core_v2.proposals p where group_id=g and status<>'draft' order by (status in ('submitted','changes_requested','approved')) desc,submitted_at desc nulls last,id desc limit 1$$;
create function fyp_core_v2.authorize(g uuid) returns text language plpgsql stable security definer set search_path='' as $$declare r text;begin r:=fyp_core_v2.role();if (r='student' and exists(select 1 from fyp_core_v2.members where group_id=g and student_id=auth.uid())) or (r='supervisor' and exists(select 1 from fyp_core_v2.allocations where group_id=g and supervisor_id=auth.uid())) then return r;end if;raise exception 'Other group is unavailable' using errcode='42501';end $$;
create function fyp_core_v2.document(g uuid,d jsonb) returns void language plpgsql security definer set search_path='' as $$begin
if d is null then return;end if;
if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'size') is distinct from 'number' or (d->>'size')::numeric not between 1 and 10485760 or d->>'name' is null or length(d->>'name') not between 1 and 255 or d->>'path' is null or split_part(d->>'path','/',1)<>auth.uid()::text or split_part(d->>'path','/',2)<>g::text or d->>'path' !~ '\.(pdf|doc|docx)$' then raise exception 'Invalid private document';end if;
if not exists(select 1 from storage.objects where bucket_id='fyp-v2-submissions' and name=d->>'path' and (metadata->>'size')::numeric=(d->>'size')::numeric) then raise exception 'Uploaded document is missing or size differs';end if;
end $$;
create function public.fyp_v2_core_get_student_workspace() returns jsonb language plpgsql security definer set search_path='' as $$declare s fyp_core_v2.sessions;g fyp_core_v2.groups;p fyp_core_v2.proposals;a jsonb;begin
perform fyp_core_v2.role('student');select * into s from fyp_core_v2.sessions where active;select gr.* into g from fyp_core_v2.groups gr join fyp_core_v2.members m on m.group_id=gr.id where m.student_id=auth.uid() and gr.session_id=s.id;if g.id is not null then p:=fyp_core_v2.proposal(g.id);end if;
select jsonb_build_object('supervisor_id',al.supervisor_id,'supervisor_name',pr.full_name,'preference_rank',al.preference_rank,'explanation',al.explanation) into a from fyp_core_v2.allocations al join public.fyp_profiles pr on pr.id=al.supervisor_id where al.group_id=g.id;
return jsonb_build_object('session',case when s.id is not null then jsonb_build_object('id',s.id,'name',s.name) else null end,'topics',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from fyp_core_v2.topics t),'supervisors',(select coalesce(jsonb_agg(jsonb_build_object('id',c.supervisor_id,'full_name',pr.full_name,'topics',(select coalesce(jsonb_agg(t.name),'[]') from fyp_core_v2.topics t where t.id=any(c.topic_ids))) order by pr.full_name),'[]') from fyp_core_v2.capacities c join public.fyp_profiles pr on pr.id=c.supervisor_id where c.session_id=s.id),'eligible_members',(select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'full_name',pr.full_name,'role','student')),'[]') from fyp_core_v2.participants e join public.fyp_profiles pr on pr.id=e.profile_id where e.session_id=s.id and pr.role::text='student' and pr.id<>auth.uid() and not exists(select 1 from fyp_core_v2.members m join fyp_core_v2.groups gr on gr.id=m.group_id where m.student_id=pr.id and gr.session_id=s.id)),'group',case when g.id is not null then to_jsonb(g)||jsonb_build_object('members',fyp_core_v2.members(g.id)) else null end,'proposal',case when p.id is not null then jsonb_build_object('id',p.id,'group_id',p.group_id,'title',p.title,'abstract',p.abstract,'keywords',p.keywords,'topic_ids',p.topic_ids,'supervisor_ids',(select jsonb_agg(coalesce(x::text,'')) from unnest(p.supervisor_ids) x),'status',p.status,'document',p.document,'submitted_at',p.submitted_at,'feedback',p.feedback) else null end,'allocation',a);
end $$;
create function public.fyp_v2_core_create_student_group(p_name text,p_session_id uuid,p_member_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$declare students uuid[];g uuid;begin
perform fyp_core_v2.role('student');perform fyp_core_v2.lock();students:=array_prepend(auth.uid(),coalesce(p_member_ids,'{}'));
if p_name is null or length(btrim(p_name)) not between 1 and 100 or cardinality(students) not between 1 and 3 or (select count(distinct x) from unnest(students) x)<>cardinality(students) then raise exception 'One to three distinct members and a group name are required';end if;
if not exists(select 1 from fyp_core_v2.sessions where id=p_session_id and active) or (select count(*) from fyp_core_v2.participants e join public.fyp_profiles pr on pr.id=e.profile_id where e.profile_id=any(students) and e.session_id=p_session_id and pr.role::text='student')<>cardinality(students) then raise exception 'Students must be enrolled in the active session';end if;
if exists(select 1 from fyp_core_v2.members m join fyp_core_v2.groups g on g.id=m.group_id where student_id=any(students) and g.session_id=p_session_id) then raise exception 'A student already belongs to a group';end if;
insert into fyp_core_v2.groups(session_id,name) values(p_session_id,btrim(p_name)) returning id into g;insert into fyp_core_v2.members select g,x from unnest(students) x;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'group_created',g::text,jsonb_build_object('members',students));return public.fyp_v2_core_get_student_workspace();end $$;
create function public.fyp_v2_core_save_student_proposal(p_group_id uuid,p_title text,p_abstract text,p_keywords text[],p_topic_ids uuid[],p_supervisor_ids uuid[],p_document jsonb,p_submit boolean) returns jsonb language plpgsql security definer set search_path='' as $$declare p fyp_core_v2.proposals;s uuid;pid uuid;begin
perform fyp_core_v2.role('student');perform fyp_core_v2.lock();perform fyp_core_v2.authorize(p_group_id);select session_id into s from fyp_core_v2.groups where id=p_group_id;p:=fyp_core_v2.proposal(p_group_id);
if not exists(select 1 from fyp_core_v2.sessions where id=s and active) then raise exception 'Proposal session is not active';end if;
if p.status in ('submitted','approved') then raise exception 'Proposal is already submitted or approved';end if;
if p_title is null or p_abstract is null or p_keywords is null or p_topic_ids is null or p_supervisor_ids is null or p_submit is null or cardinality(p_supervisor_ids)<>3 or cardinality(p_topic_ids)>3 or length(p_title)>300 or length(p_abstract)>10000 or cardinality(p_keywords)>20 or exists(select 1 from unnest(p_keywords) k where k is null or length(btrim(k)) not between 1 and 100) then raise exception 'Invalid proposal fields';end if;
if (select count(distinct x) from unnest(p_topic_ids) x)<>cardinality(p_topic_ids) or exists(select 1 from unnest(p_topic_ids) x where not exists(select 1 from fyp_core_v2.topics where id=x)) or (select count(distinct x) from unnest(p_supervisor_ids) x where x is not null)<>(select count(*) from unnest(p_supervisor_ids) x where x is not null) or exists(select 1 from unnest(p_supervisor_ids) x where x is not null and not exists(select 1 from fyp_core_v2.capacities where session_id=s and supervisor_id=x)) then raise exception 'Invalid controlled topics or distinct supervisor preferences';end if;
if p_submit and (length(btrim(p_title))=0 or length(btrim(p_abstract))=0 or cardinality(p_keywords)=0 or array_position(p_supervisor_ids,null) is not null) then raise exception 'Complete all submitted proposal fields';end if;
perform fyp_core_v2.document(p_group_id,p_document);
if p.id is not null and p.status in ('draft','changes_requested') then update fyp_core_v2.proposals set title=btrim(p_title),abstract=btrim(p_abstract),keywords=p_keywords,topic_ids=p_topic_ids,supervisor_ids=p_supervisor_ids,document=p_document,status=case when p_submit then 'submitted' when p.status='changes_requested' then 'changes_requested' else 'draft' end,submitted_at=case when p_submit then now() else submitted_at end,similarity='{"percentage":null,"closest_title":null,"status":"pending"}' where id=p.id returning id into pid;
else insert into fyp_core_v2.proposals(group_id,title,abstract,keywords,topic_ids,supervisor_ids,document,status,submitted_at) values(p_group_id,btrim(p_title),btrim(p_abstract),p_keywords,p_topic_ids,p_supervisor_ids,p_document,case when p_submit then 'submitted' else 'draft' end,case when p_submit then now() else null end) returning id into pid;end if;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'proposal_saved',pid::text,jsonb_build_object('submitted',p_submit));return public.fyp_v2_core_get_student_workspace();end $$;
create function fyp_core_v2.project(g uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare p fyp_core_v2.proposals;begin
p:=fyp_core_v2.proposal(g);return jsonb_build_object('id',g,'group_name',(select name from fyp_core_v2.groups where id=g),'title',p.title,'supervisor_id',(select supervisor_id from fyp_core_v2.allocations where group_id=g),'members',fyp_core_v2.members(g),'milestones',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'description',m.description,'deadline',m.deadline,'status',m.status,'submissions',(select coalesce(jsonb_agg(jsonb_build_object('id',su.id,'submitted_by',su.submitted_by,'submitted_at',su.submitted_at,'document',su.document,'review',su.review,'contributions',(select coalesce(jsonb_agg(to_jsonb(st)-'submission_id'),'[]') from fyp_core_v2.statements st where submission_id=su.id)) order by su.submitted_at,su.id),'[]') from fyp_core_v2.submissions su where milestone_id=m.id)) order by m.deadline,m.id),'[]') from fyp_core_v2.milestones m where group_id=g));end $$;
create function fyp_core_v2.milestone_workspace() returns jsonb language plpgsql security definer set search_path='' as $$declare r text;begin r:=fyp_core_v2.role();if r not in ('student','supervisor') then raise exception 'Role denied' using errcode='42501';end if;return jsonb_build_object('actor_id',auth.uid(),'projects',(select coalesce(jsonb_agg(fyp_core_v2.project(g.id) order by g.id),'[]') from fyp_core_v2.groups g join fyp_core_v2.allocations a on a.group_id=g.id where (fyp_core_v2.proposal(g.id)).status='approved' and ((r='student' and exists(select 1 from fyp_core_v2.members where group_id=g.id and student_id=auth.uid())) or (r='supervisor' and a.supervisor_id=auth.uid()))));end $$;
create function public.fyp_v2_core_get_milestone_workspace() returns jsonb language sql security definer set search_path='' as $$select fyp_core_v2.milestone_workspace()$$;
create function public.fyp_v2_core_get_supervisor_workspace() returns jsonb language plpgsql security definer set search_path='' as $$declare sid uuid;begin
perform fyp_core_v2.role('supervisor');select id into sid from fyp_core_v2.sessions where active;return jsonb_build_object('supervisor_id',auth.uid(),'session_name',coalesce((select name from fyp_core_v2.sessions where id=sid),'No active session'),'capacity',coalesce((select max_groups from fyp_core_v2.capacities where session_id=sid and supervisor_id=auth.uid()),0),'proposals',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'group_id',g.id,'group_name',g.name,'members',fyp_core_v2.members(g.id),'title',p.title,'abstract',p.abstract,'keywords',p.keywords,'topics',(select coalesce(jsonb_agg(name),'[]') from fyp_core_v2.topics where id=any(p.topic_ids)),'status',p.status,'submitted_at',p.submitted_at,'document',p.document,'similarity',p.similarity,'review',p.review,'project',case when p.status='approved' then jsonb_build_object('id',g.id,'title',p.title,'started_at',p.started_at,'milestones',(fyp_core_v2.project(g.id))->'milestones') else null end)),'[]') from fyp_core_v2.groups g join fyp_core_v2.allocations a on a.group_id=g.id cross join lateral fyp_core_v2.visible_proposal(g.id) p where a.supervisor_id=auth.uid() and g.session_id=sid));end $$;
create function public.fyp_v2_core_run_similarity_screen(p_proposal_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare p fyp_core_v2.proposals;other fyp_core_v2.proposals;score numeric;best numeric:=0;best_title text;best_id uuid;words text[];begin
perform fyp_core_v2.role('supervisor');perform fyp_core_v2.lock();select * into p from fyp_core_v2.proposals where id=p_proposal_id;if p.id is null then raise exception 'Proposal unavailable' using errcode='42501';end if;perform fyp_core_v2.authorize(p.group_id);if p.status<>'submitted' then raise exception 'Only submitted proposals can be screened';end if;
select array_agg(distinct x) into words from unnest(regexp_split_to_array(lower(p.title||' '||p.abstract),'[^[:alnum:]]+')) x where length(x)>1;
for other in select * from fyp_core_v2.proposals where id<>p.id and status<>'draft' order by id loop
with b as(select distinct x from unnest(regexp_split_to_array(lower(other.title||' '||other.abstract),'[^[:alnum:]]+')) x where length(x)>1),a as(select distinct unnest(coalesce(words,'{}')) x)
select case when (select count(*) from (select x from a union select x from b) u)=0 then 0 else (select count(*) from (select x from a intersect select x from b) c)::numeric/(select count(*) from (select x from a union select x from b) u)*100 end into score;
if score>best then best:=score;best_title:=other.title;best_id:=other.id;end if;end loop;
update fyp_core_v2.proposals set similarity=jsonb_build_object('percentage',round(best,2),'closest_title',best_title,'closest_proposal_id',best_id,'status',case when best>=60 then 'flagged' else 'clear' end,'threshold',60,'screened_at',now(),'method','Token-set Jaccard internal comparison','disclaimer','Internal similarity screening is a review signal, not a plagiarism verdict.') where id=p.id;
return jsonb_build_object('screened',true);end $$;
create function public.fyp_v2_core_review_supervisor_proposal(p_proposal_id uuid,p_action text,p_comment text,p_justification text,p_expected_status text) returns jsonb language plpgsql security definer set search_path='' as $$declare p fyp_core_v2.proposals;s uuid;begin
perform fyp_core_v2.role('supervisor');perform fyp_core_v2.lock();select * into p from fyp_core_v2.proposals where id=p_proposal_id;if p.id is null then raise exception 'Proposal unavailable' using errcode='42501';end if;perform fyp_core_v2.authorize(p.group_id);
if p.status<>'submitted' or p_expected_status is distinct from 'submitted' then raise exception 'Proposal changed' using errcode='40001';end if;
if p_action is null or p_action not in ('approve','changes_requested','reject') or p_comment is null or p_justification is null or length(p_comment)>4000 or length(p_justification)>4000 or (p_action<>'approve' and length(btrim(p_comment))=0) or (p_action='approve' and (p.similarity->>'status'='pending' or (p.similarity->>'status'='flagged' and length(btrim(p_justification))=0))) then raise exception 'Review comments, completed screening and flagged approval justification are required';end if;
select session_id into s from fyp_core_v2.groups where id=p.group_id;if p_action='approve' and not exists(select 1 from fyp_core_v2.templates where session_id=s) then raise exception 'Configure milestone templates before approval';end if;
update fyp_core_v2.proposals set status=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,feedback=nullif(btrim(p_comment),''),review=jsonb_build_object('action',p_action,'comment',btrim(p_comment),'justification',btrim(p_justification),'reviewer_id',auth.uid(),'reviewed_at',now()),started_at=case when p_action='approve' then now() else started_at end where id=p.id;
if p_action='approve' then insert into fyp_core_v2.milestones(group_id,name,description,deadline) select p.group_id,name,description,now()+days*interval '1 day' from fyp_core_v2.templates where session_id=s on conflict(group_id,name) do nothing;end if;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'proposal_'||p_action,p.id::text,jsonb_build_object('comment',p_comment,'justification',p_justification));return public.fyp_v2_core_get_supervisor_workspace();end $$;
create function public.fyp_v2_core_submit_student_milestone(p_milestone_id uuid,p_document jsonb,p_statement text,p_expected_submission_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare m fyp_core_v2.milestones;latest uuid;sid uuid;begin
perform fyp_core_v2.role('student');perform fyp_core_v2.lock();select * into m from fyp_core_v2.milestones where id=p_milestone_id;if m.id is null then raise exception 'Milestone unavailable' using errcode='42501';end if;perform fyp_core_v2.authorize(m.group_id);
select id into latest from fyp_core_v2.submissions where milestone_id=m.id order by submitted_at desc,id desc limit 1;
if m.status not in ('not_started','needs_rework') or latest is distinct from p_expected_submission_id then raise exception 'Milestone changed or already submitted' using errcode='40001';end if;
if p_document is null or p_statement is null or length(btrim(p_statement)) not between 1 and 4000 then raise exception 'A document and individual statement are required';end if;perform fyp_core_v2.document(m.group_id,p_document);
insert into fyp_core_v2.submissions(milestone_id,submitted_by,document) values(m.id,auth.uid(),p_document) returning id into sid;insert into fyp_core_v2.statements values(sid,auth.uid(),btrim(p_statement),now());update fyp_core_v2.milestones set status='submitted' where id=m.id;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'milestone_submitted',m.id::text,jsonb_build_object('submission_id',sid));return fyp_core_v2.milestone_workspace();end $$;
create function public.fyp_v2_core_save_milestone_contribution(p_milestone_id uuid,p_submission_id uuid,p_statement text) returns jsonb language plpgsql security definer set search_path='' as $$declare m fyp_core_v2.milestones;latest uuid;begin
perform fyp_core_v2.role('student');perform fyp_core_v2.lock();select * into m from fyp_core_v2.milestones where id=p_milestone_id;if m.id is null then raise exception 'Milestone unavailable' using errcode='42501';end if;perform fyp_core_v2.authorize(m.group_id);select id into latest from fyp_core_v2.submissions where milestone_id=m.id order by submitted_at desc,id desc limit 1;
if latest is distinct from p_submission_id or latest is null or m.status<>'submitted' then raise exception 'Submission changed or was reviewed' using errcode='40001';end if;
if p_statement is null or length(btrim(p_statement)) not between 1 and 4000 then raise exception 'A nonempty statement is required';end if;
insert into fyp_core_v2.statements values(p_submission_id,auth.uid(),btrim(p_statement),now()) on conflict(submission_id,student_id) do update set statement=excluded.statement,updated_at=now();return fyp_core_v2.milestone_workspace();end $$;
create function public.fyp_v2_core_review_supervisor_milestone(p_milestone_id uuid,p_submission_id uuid,p_action text,p_feedback text,p_expected_status text) returns jsonb language plpgsql security definer set search_path='' as $$declare m fyp_core_v2.milestones;latest uuid;begin
perform fyp_core_v2.role('supervisor');perform fyp_core_v2.lock();select * into m from fyp_core_v2.milestones where id=p_milestone_id;if m.id is null then raise exception 'Milestone unavailable' using errcode='42501';end if;perform fyp_core_v2.authorize(m.group_id);select id into latest from fyp_core_v2.submissions where milestone_id=m.id order by submitted_at desc,id desc limit 1;
if latest is distinct from p_submission_id or latest is null or m.status<>'submitted' or p_expected_status is distinct from 'submitted' then raise exception 'Submission changed' using errcode='40001';end if;
if p_action is null or p_action not in ('accepted','needs_rework') or p_feedback is null or length(p_feedback)>4000 or (p_action='needs_rework' and length(btrim(p_feedback))=0) then raise exception 'A valid decision and rework feedback are required';end if;
if p_action='accepted' and exists(select 1 from fyp_core_v2.members where group_id=m.group_id and not exists(select 1 from fyp_core_v2.statements where submission_id=latest and student_id=members.student_id)) then raise exception 'Every member must supply a contribution statement';end if;
update fyp_core_v2.submissions set review=jsonb_build_object('action',p_action,'feedback',p_feedback,'reviewer_id',auth.uid(),'reviewed_at',now()) where id=latest;update fyp_core_v2.milestones set status=p_action where id=m.id;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'milestone_'||p_action,m.id::text,jsonb_build_object('submission_id',latest,'feedback',p_feedback));return fyp_core_v2.milestone_workspace();end $$;

create function public.fyp_v2_core_configuration() returns jsonb language plpgsql security definer set search_path='' as $$begin perform fyp_core_v2.role('coordinator');return jsonb_build_object('actor_id',auth.uid(),'sessions',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from fyp_core_v2.sessions t),'topics',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from fyp_core_v2.topics t),'participants',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from fyp_core_v2.participants t),'capacities',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from fyp_core_v2.capacities t),'templates',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from fyp_core_v2.templates t),'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'role',role)),'[]') from public.fyp_profiles));end $$;
create function public.fyp_v2_core_configure(p_operation text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare sid uuid;uid uuid;topicids uuid[];capacity int;begin
perform fyp_core_v2.role('coordinator');perform fyp_core_v2.lock();if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid configuration';end if;
if p_operation='session' then if p_data->>'active'='true' then update fyp_core_v2.sessions set active=false where active;end if;insert into fyp_core_v2.sessions(name,active) values(p_data->>'name',coalesce((p_data->>'active')::boolean,false));
elsif p_operation='activate_session' then sid:=(p_data->>'id')::uuid;if not exists(select 1 from fyp_core_v2.sessions where id=sid) then raise exception 'Session unavailable';end if;update fyp_core_v2.sessions set active=false where active;update fyp_core_v2.sessions set active=true where id=sid;
elsif p_operation='topic' then insert into fyp_core_v2.topics(name) values(btrim(p_data->>'name'));
elsif p_operation='enroll' then sid:=(p_data->>'session_id')::uuid;uid:=(p_data->>'profile_id')::uuid;if exists(select 1 from fyp_core_v2.members m join fyp_core_v2.groups g on g.id=m.group_id join fyp_core_v2.sessions s on s.id=g.session_id where m.student_id=uid and s.active and g.session_id<>sid) then raise exception 'Grouped students cannot change active enrollment';end if;insert into fyp_core_v2.participants values(uid,sid) on conflict(profile_id,session_id) do nothing;
elsif p_operation='capacity' then sid:=(p_data->>'session_id')::uuid;uid:=(p_data->>'supervisor_id')::uuid;capacity:=(p_data->>'max_groups')::integer;if not exists(select 1 from public.fyp_profiles where id=uid and role::text='supervisor') then raise exception 'Supervisor required';end if;select coalesce(array_agg(value::text::uuid),'{}') into topicids from jsonb_array_elements_text(coalesce(p_data->'topic_ids','[]'));
if exists(select 1 from unnest(topicids) x where not exists(select 1 from fyp_core_v2.topics where id=x)) or capacity<(select count(*) from fyp_core_v2.allocations a join fyp_core_v2.groups g on g.id=a.group_id where g.session_id=sid and supervisor_id=uid) then raise exception 'Invalid topics or capacity below current workload';end if;
insert into fyp_core_v2.capacities values(sid,uid,capacity,topicids) on conflict(session_id,supervisor_id) do update set max_groups=excluded.max_groups,topic_ids=excluded.topic_ids;insert into fyp_core_v2.participants values(uid,sid) on conflict(profile_id,session_id) do nothing;
elsif p_operation='template' then if p_data->>'name' is null or length(btrim(p_data->>'name')) not between 1 and 100 or length(coalesce(p_data->>'description',''))>4000 then raise exception 'Invalid milestone template';end if;insert into fyp_core_v2.templates(session_id,name,description,days) values((p_data->>'session_id')::uuid,btrim(p_data->>'name'),coalesce(p_data->>'description',''),(p_data->>'days')::integer);
else raise exception 'Unknown configuration operation';end if;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'configuration_'||p_operation,coalesce(sid::text,'configuration'),p_data);return public.fyp_v2_core_configuration();end $$;

create function public.fyp_v2_core_match(p_seed text) returns jsonb language plpgsql security definer set search_path='' as $$declare sid uuid;rank int;c fyp_core_v2.capacities;p record;slots int;begin
perform fyp_core_v2.role('coordinator');perform fyp_core_v2.lock();if p_seed is null or length(btrim(p_seed)) not between 1 and 100 then raise exception 'A stored matching seed is required';end if;select id into sid from fyp_core_v2.sessions where active;if sid is null then raise exception 'Activate a session first';end if;
for rank in 1..3 loop for c in select * from fyp_core_v2.capacities where session_id=sid order by supervisor_id loop
slots:=c.max_groups-(select count(*) from fyp_core_v2.allocations a join fyp_core_v2.groups g on g.id=a.group_id where g.session_id=sid and a.supervisor_id=c.supervisor_id);
for p in select pr.*,least(3,(select count(*) from unnest(pr.topic_ids) x where x=any(c.topic_ids))) as topic_points from fyp_core_v2.proposals pr join fyp_core_v2.groups g on g.id=pr.group_id where g.session_id=sid and pr.status='submitted' and pr.supervisor_ids[rank]=c.supervisor_id and not exists(select 1 from fyp_core_v2.allocations where group_id=g.id) order by topic_points desc,md5(p_seed||':'||pr.id::text),pr.id limit greatest(slots,0) loop
insert into fyp_core_v2.allocations(group_id,supervisor_id,preference_rank,explanation,seed) values(p.group_id,c.supervisor_id,rank,'Preference round '||rank||'; topic tie points '||p.topic_points||'/3; stored seed '||p_seed||'; available capacity before round '||slots||'.',p_seed);
end loop;end loop;end loop;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'batch_matching',sid::text,jsonb_build_object('seed',p_seed));return public.fyp_v2_core_configuration();end $$;
create function public.fyp_v2_core_manual_allocate(p_group_id uuid,p_supervisor_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare sid uuid;c fyp_core_v2.capacities;old fyp_core_v2.allocations;begin
perform fyp_core_v2.role('coordinator');perform fyp_core_v2.lock();select session_id into sid from fyp_core_v2.groups where id=p_group_id;if sid is null or p_reason is null or length(btrim(p_reason)) not between 1 and 4000 then raise exception 'Group and manual allocation reason are required';end if;
select * into c from fyp_core_v2.capacities where session_id=sid and supervisor_id=p_supervisor_id;if c.supervisor_id is null or (select count(*) from fyp_core_v2.allocations a join fyp_core_v2.groups g on g.id=a.group_id where g.session_id=sid and a.supervisor_id=p_supervisor_id and a.group_id<>p_group_id)>=c.max_groups then raise exception 'Supervisor capacity is unavailable';end if;
select * into old from fyp_core_v2.allocations where group_id=p_group_id;
if (fyp_core_v2.proposal(p_group_id)).id is null or (fyp_core_v2.proposal(p_group_id)).status='draft' then raise exception 'A submitted proposal is required for allocation';end if;
insert into fyp_core_v2.allocations(group_id,supervisor_id,explanation) values(p_group_id,p_supervisor_id,'Manual allocation: '||btrim(p_reason)) on conflict(group_id) do update set supervisor_id=excluded.supervisor_id,preference_rank=null,seed=null,explanation=excluded.explanation,created_at=now();
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'manual_allocation',p_group_id::text,jsonb_build_object('previous',to_jsonb(old),'supervisor_id',p_supervisor_id,'reason',p_reason));return public.fyp_v2_core_configuration();end $$;
create function public.fyp_v2_core_report() returns jsonb language plpgsql security definer set search_path='' as $$begin perform fyp_core_v2.role('coordinator');return jsonb_build_object('actor_id',auth.uid(),'sessions',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from fyp_core_v2.sessions s),'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'session_id',g.session_id,'name',g.name,'members',fyp_core_v2.members(g.id),'proposal',to_jsonb(fyp_core_v2.proposal(g.id)),'allocation',(select to_jsonb(a) from fyp_core_v2.allocations a where group_id=g.id))),'[]') from fyp_core_v2.groups g),'capacities',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('allocated',(select count(*) from fyp_core_v2.allocations a join fyp_core_v2.groups g on g.id=a.group_id where a.supervisor_id=c.supervisor_id and g.session_id=c.session_id))),'[]') from fyp_core_v2.capacities c),'milestones',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from fyp_core_v2.milestones m),'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from fyp_core_v2.audit a));end $$;
create function public.fyp_v2_core_accreditation() returns jsonb language plpgsql security definer set search_path='' as $$declare group_row record;begin
perform fyp_core_v2.role('coordinator');
for group_row in select id from fyp_core_v2.groups where (fyp_core_v2.proposal(id)).status='approved' order by id loop perform fyp_health_v2.refresh(fyp_core_v2.project(group_row.id));end loop;
return public.fyp_v2_core_report()||jsonb_build_object(
'participants',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from fyp_core_v2.participants p),
'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'role',role)),'[]') from public.fyp_profiles),
'topics',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from fyp_core_v2.topics t),
'health',(select coalesce(jsonb_agg(jsonb_build_object('project_id',h.project_id,'level',h.health->>'level','calculated_at',h.health->>'calculated_at')),'[]') from fyp_health_v2.snapshots h join fyp_core_v2.groups g on g.id::text=h.project_id),
'peer_reviews',(select coalesce(jsonb_agg(jsonb_build_object('project_id',g.id,'students',(select jsonb_agg(fyp_assessment_v2.peer(h.evidence->'project',m.student_id)-'ratings'-'signature') from fyp_core_v2.members m where group_id=g.id))),'[]') from fyp_core_v2.groups g join fyp_health_v2.snapshots h on h.project_id=g.id::text),
'defenses',(select coalesce(jsonb_agg((to_jsonb(d)-'project')||jsonb_build_object('assessments_received',(select count(*) from fyp_assessment_v2.assessments where defense_id=d.id))),'[]') from fyp_assessment_v2.defenses d join fyp_core_v2.groups g on g.id::text=d.project_id),
'results',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('project_id',d.project_id)),'[]') from fyp_assessment_v2.results r join fyp_assessment_v2.defenses d on d.id=r.defense_id join fyp_core_v2.groups g on g.id::text=d.project_id),
'assessment_audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from fyp_assessment_v2.audit a));end $$;
revoke all on all functions in schema fyp_core_v2 from public,anon,authenticated;
do $$declare f record;begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fyp_v2_core_%' loop execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
notify pgrst,'reload schema';commit;


-- SOURCE: supabase/migrations/202610080003_health_v2.sql
-- Additive health/peer backend. Keeps all established FYP tables and RPCs intact.
-- Requires the established fyp_profiles and get_milestone_workspace contract.
-- Run as the FYP project owner. This file has not been installed remotely.

do $guard$
begin
  if to_regclass('public.fyp_profiles') is null or (to_regprocedure('public.get_milestone_workspace()') is null and to_regprocedure('fyp_core_v2.milestone_workspace()') is null) then
    raise exception 'Install the established profile/milestone backend first';
  end if;
  if exists(select 1 from pg_namespace where nspname='fyp_health_v2') then
    raise exception 'Health v2 already exists; do not reapply the initial migration';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_health_workspace','calculate_group_health','prepare_group_health_draft','save_group_health_draft','review_group_health','mark_health_notice_read','create_group_health_fallback','fyp_v2_peer_workspace','fyp_v2_save_peer_rating','fyp_v2_set_peer_due','fyp_v2_set_contribution_percent')) then
    raise exception 'A target RPC already exists; inspect definitions instead of replacing it';
  end if;
end $guard$;
create schema fyp_health_v2;
revoke all on schema fyp_health_v2 from public,anon,authenticated;
create table fyp_health_v2.settings(project_id text primary key,peers_required boolean not null default false);
create table fyp_health_v2.ratings(project_id text not null,evaluator uuid not null,evaluated uuid not null,rating smallint not null check(rating between 1 and 5),created_at timestamptz not null default now(),primary key(project_id,evaluator,evaluated),check(evaluator<>evaluated));
create table fyp_health_v2.contributions(project_id text not null,student_id uuid not null,percent numeric not null check(percent between 0 and 100),primary key(project_id,student_id));
create table fyp_health_v2.snapshots(project_id text primary key,evidence jsonb not null,health jsonb not null,version integer not null default 1 check(version>0));
create table fyp_health_v2.reports(id uuid primary key default gen_random_uuid(),project_id text not null,risk_fingerprint text not null,evidence_version integer not null,source text not null check(source in ('gemini','fallback')),status text not null default 'draft' check(status in ('draft','approved','rejected')),version integer not null default 1,created_at timestamptz not null default now(),reviewed_at timestamptz,reviewer_id uuid,explanation text not null,action text not null,message text not null,original_text jsonb not null,check(version>0),check(length(explanation) between 1 and 4000),check(length(action) between 1 and 4000),check(length(message) between 1 and 4000));
create unique index one_active_draft on fyp_health_v2.reports(project_id,risk_fingerprint) where status='draft';
create table fyp_health_v2.notices(id uuid primary key default gen_random_uuid(),report_id uuid not null unique references fyp_health_v2.reports(id),project_id text not null,body text not null,level text not null check(level in ('green','amber','red')),created_at timestamptz not null default now(),recipients uuid[] not null,check(length(body) between 1 and 4000));
create table fyp_health_v2.reads(notice_id uuid not null references fyp_health_v2.notices(id),student_id uuid not null,read_at timestamptz not null default now(),primary key(notice_id,student_id));
create table fyp_health_v2.audit(id bigint generated always as identity primary key,actor uuid not null,action text not null,record_id text not null,details jsonb not null,created_at timestamptz not null default now());
do $rls$ declare t text;begin foreach t in array array['settings','ratings','contributions','snapshots','reports','notices','reads','audit'] loop execute format('alter table fyp_health_v2.%I enable row level security',t);end loop;end $rls$;
revoke all on all tables in schema fyp_health_v2 from public,anon,authenticated;
revoke all on all sequences in schema fyp_health_v2 from public,anon,authenticated;

create function fyp_health_v2.role() returns text language plpgsql stable security definer set search_path='' as $$
declare r text;begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode='42501';end if;
  select role::text into r from public.fyp_profiles where id=auth.uid();
  if r is null then raise exception 'No role profile' using errcode='42501';end if;
  return r;
end $$;
create function fyp_health_v2.projects() returns jsonb language plpgsql security definer set search_path='' as $$
declare w jsonb;p jsonb;r text;v2 boolean:=false;begin
  r:=fyp_health_v2.role();if r not in ('student','supervisor') then raise exception 'Role is not permitted' using errcode='42501';end if;
  if to_regclass('fyp_core_v2.participants') is not null then execute 'select exists(select 1 from fyp_core_v2.participants where profile_id=$1)' into v2 using auth.uid();end if;
  if v2 then execute 'select fyp_core_v2.milestone_workspace()' into w;else w:=public.get_milestone_workspace()::jsonb;end if;
  if w->>'actor_id' is distinct from auth.uid()::text or jsonb_typeof(w->'projects') is distinct from 'array' then raise exception 'Invalid milestone adapter contract';end if;
  for p in select value from jsonb_array_elements(w->'projects') loop
    if jsonb_typeof(p->'members') is distinct from 'array' or jsonb_array_length(p->'members') not between 1 and 3 or jsonb_typeof(p->'milestones') is distinct from 'array' then raise exception 'Invalid project evidence';end if;
    if (select count(distinct value->>'id') from jsonb_array_elements(p->'members'))<>jsonb_array_length(p->'members') then raise exception 'Duplicate member evidence';end if;
    if r='supervisor' and p->>'supervisor_id' is distinct from auth.uid()::text then raise exception 'Unassigned project' using errcode='42501';end if;
    if r='student' and not exists(select 1 from jsonb_array_elements(p->'members') where value->>'id'=auth.uid()::text) then raise exception 'Other group' using errcode='42501';end if;
  end loop;
  return w->'projects';
end $$;
create function fyp_health_v2.project(p_id text,p_supervisor boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;begin
  if p_supervisor and fyp_health_v2.role()<>'supervisor' then raise exception 'Assigned supervisor required' using errcode='42501';end if;
  select value into p from jsonb_array_elements(fyp_health_v2.projects()) where value->>'id'=p_id;
  if p is null then raise exception 'Project unavailable' using errcode='42501';end if;
  return p;
end $$;
create function fyp_health_v2.input(p jsonb) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('project_id',p->>'id','peers_required',coalesce((select peers_required from fyp_health_v2.settings where project_id=p->>'id'),false),'peers',(select coalesce(jsonb_agg(jsonb_build_object('member_id',m.value->>'id','ratings',coalesce((select jsonb_agg(r.rating order by r.evaluator) from fyp_health_v2.ratings r where r.project_id=p->>'id' and r.evaluated::text=m.value->>'id' and exists(select 1 from jsonb_array_elements(p->'members') e where e.value->>'id'=r.evaluator::text)),'[]'::jsonb),'supervisor_percent',(select percent from fyp_health_v2.contributions where project_id=p->>'id' and student_id::text=m.value->>'id')) order by m.ordinality),'[]'::jsonb) from jsonb_array_elements(p->'members') with ordinality m));
$$;

-- Rule text deliberately matches src/health/rules.ts. AI never sets a risk colour.
create function fyp_health_v2.rules(p jsonb,i jsonb,t timestamptz) returns jsonb language plpgsql immutable set search_path='' as $$
declare rules jsonb:='[]';m jsonb;s jsonb;latest jsonb;peer jsonb;member jsonb;due timestamptz;reworks int;missing int;idx int:=0;cnt int;expected int;av numeric;spread numeric;pct numeric;level text;fingerprint text;
begin
  t:=date_trunc('milliseconds',t);
  for m in select value from jsonb_array_elements(p->'milestones') loop
    due:=date_trunc('milliseconds',(m->>'deadline')::timestamptz);
    latest:=m->'submissions'->(jsonb_array_length(m->'submissions')-1);
    if m->>'status'<>'accepted' and due>=t and due-t<=interval '3 days' then rules:=rules||jsonb_build_array(jsonb_build_object('code','DEADLINE_UPCOMING','level','amber','evidence',(m->>'name')||': deadline '||(m->>'deadline')||' is within three days.'));end if;
    if m->>'status'<>'accepted' and due<t and (latest is null or m->>'status'='needs_rework') then rules:=rules||jsonb_build_array(jsonb_build_object('code','MILESTONE_OVERDUE','level','red','evidence',(m->>'name')||': deadline '||(m->>'deadline')||' passed; acceptable evidence is still outstanding.'));end if;
    if latest is not null and date_trunc('milliseconds',(latest->>'submitted_at')::timestamptz)>due then rules:=rules||jsonb_build_array(jsonb_build_object('code','MILESTONE_LATE','level','amber','evidence',(m->>'name')||': submitted '||(latest->>'submitted_at')||', after deadline '||(m->>'deadline')||'.'));end if;
    select count(*) into reworks from jsonb_array_elements(m->'submissions') where value->'review'->>'action'='needs_rework';
    if reworks>=2 then rules:=rules||jsonb_build_array(jsonb_build_object('code','REPEATED_REWORK','level','red','evidence',(m->>'name')||': '||reworks||' rework decisions.'));end if;
    if latest is not null then
      select count(*) into missing from jsonb_array_elements(p->'members') a where not exists(select 1 from jsonb_array_elements(latest->'contributions') c where c.value->>'student_id'=a.value->>'id' and length(btrim(c.value->>'statement'))>0);
      if missing>0 then rules:=rules||jsonb_build_array(jsonb_build_object('code','CONTRIBUTIONS_MISSING','level','amber','evidence',(m->>'name')||': '||missing||' contribution statements missing.'));end if;
    end if;
  end loop;
  expected:=jsonb_array_length(p->'members')-1;
  if (i->>'peers_required')::boolean and expected>0 then
    for member in select value from jsonb_array_elements(p->'members') loop
      idx:=idx+1;select value into peer from jsonb_array_elements(i->'peers') where value->>'member_id'=member->>'id';
      cnt:=coalesce(jsonb_array_length(peer->'ratings'),0);
      if cnt<expected then rules:=rules||jsonb_build_array(jsonb_build_object('code','PEER_RATINGS_MISSING','level','amber','evidence','Member '||idx||': '||cnt||'/'||expected||' required peer ratings received.'));end if;
      if cnt=0 then continue;end if;
      select avg(value::text::numeric),max(value::text::numeric)-min(value::text::numeric) into av,spread from jsonb_array_elements(peer->'ratings');
      pct:=(peer->>'supervisor_percent')::numeric;
      if av<2.5 then rules:=rules||jsonb_build_array(jsonb_build_object('code','PEER_AVERAGE_LOW','level','red','evidence','Member '||idx||': peer average '||to_char(av,'FM990.00')||'/5 is below 2.5.'));end if;
      if spread>=2 then rules:=rules||jsonb_build_array(jsonb_build_object('code','PEER_RATING_SPREAD','level','amber','evidence','Member '||idx||': rating spread '||to_char(spread,'FM990.00')||' is at least two points.'));end if;
      if pct is not null and abs(av/5*100-pct)>30 then rules:=rules||jsonb_build_array(jsonb_build_object('code','CONTRIBUTION_DIFFERENCE','level','red','evidence','Member '||idx||': peer contribution '||to_char(av/5*100,'FM990.00')||'%, supervisor contribution '||to_char(pct,'FM990.00')||'%; difference exceeds 30 percentage points.'));end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(value order by (value->>'code')||(value->>'evidence') collate "C"),'[]') into rules from jsonb_array_elements(rules);
  level:=case when exists(select 1 from jsonb_array_elements(rules) where value->>'level'='red') then 'red' when jsonb_array_length(rules)>0 then 'amber' else 'green' end;
  fingerprint:=jsonb_build_object('version','1','project_id',p->>'id','rules',rules)::text;
  return jsonb_build_object('level',level,'rules',rules,'fingerprint',fingerprint,'calculated_at',t);
end $$;
create function fyp_health_v2.refresh(p jsonb) returns fyp_health_v2.snapshots language plpgsql security definer set search_path='' as $$
declare i jsonb;h jsonb;e jsonb;s fyp_health_v2.snapshots;begin
  perform pg_advisory_xact_lock(hashtextextended('fyp-health:'||(p->>'id'),0));
  i:=fyp_health_v2.input(p);h:=fyp_health_v2.rules(p,i,now());e:=jsonb_build_object('project',p,'input',i);
  insert into fyp_health_v2.snapshots(project_id,evidence,health) values(p->>'id',e,h)
  on conflict(project_id) do update set version=fyp_health_v2.snapshots.version+case when fyp_health_v2.snapshots.evidence is distinct from excluded.evidence or fyp_health_v2.snapshots.health->>'fingerprint' is distinct from excluded.health->>'fingerprint' then 1 else 0 end,evidence=excluded.evidence,health=excluded.health returning * into s;
  with superseded as (update fyp_health_v2.reports set status='rejected',version=version+1,reviewed_at=now(),reviewer_id=null where project_id=s.project_id and status='draft' and evidence_version<>s.version returning id,version)
  insert into fyp_health_v2.audit(actor,action,record_id,details) select auth.uid(),'stale_draft_superseded',id::text,jsonb_build_object('evidence_version',s.version,'report_version',version,'automatic',true) from superseded;
  return s;
end $$;
create function public.create_group_health_fallback(p_project_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;s fyp_health_v2.snapshots;explanation text;student_summary text;action text;message text;begin
p:=fyp_health_v2.project(p_project_id,true);s:=fyp_health_v2.refresh(p);
if s.health->>'level'='green' then raise exception 'No intervention draft is needed';end if;
if exists(select 1 from fyp_health_v2.reports where project_id=p_project_id and status='draft' and evidence_version=s.version) then return public.get_health_workspace();end if;
select string_agg(value->>'evidence',' ' order by value->>'code') into explanation from jsonb_array_elements(s.health->'rules');
select string_agg(distinct case value->>'code' when 'DEADLINE_UPCOMING' then 'A milestone deadline is approaching.' when 'MILESTONE_OVERDUE' then 'Milestone evidence is overdue.' when 'MILESTONE_LATE' then 'Milestone evidence was submitted late.' when 'REPEATED_REWORK' then 'Repeated rework needs attention.' when 'CONTRIBUTIONS_MISSING' then 'Contribution statements are outstanding.' when 'PEER_RATINGS_MISSING' then 'Complete pending peer-rating submissions.' else 'Contribution evidence needs a supervisor review.' end,' ') into student_summary from jsonb_array_elements(s.health->'rules');
action:=case when s.health->>'level'='red' then 'Contact your supervisor and agree a recovery plan for the outstanding evidence.' else 'Review upcoming deadlines and complete outstanding contributions or peer ratings.' end;
message:='Project health is '||upper(s.health->>'level')||'. '||student_summary||' '||action;
perform public.save_group_health_draft(p_project_id,s.version,s.health,jsonb_build_object('explanation',left(explanation,4000),'action',action,'message',message),'fallback');
return public.get_health_workspace();end $$;

create function public.get_health_workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;s fyp_health_v2.snapshots;r text;projects jsonb:='[]';ids text[]:='{}';reports jsonb;notices jsonb;h jsonb;begin
  r:=fyp_health_v2.role();
  for p in select value from jsonb_array_elements(fyp_health_v2.projects()) loop
    s:=fyp_health_v2.refresh(p);ids:=array_append(ids,p->>'id');h:=s.health;
    if r='student' then h:=h||jsonb_build_object('rules','[]'::jsonb,'fingerprint','');end if;
    projects:=projects||jsonb_build_array(jsonb_build_object('id',p->>'id','name',p->>'group_name','title',p->>'title','supervisor_id',p->>'supervisor_id','member_ids',(select jsonb_agg(value->>'id') from jsonb_array_elements(p->'members')),'prepared',false,'health',h));
  end loop;
  if r='supervisor' then select coalesce(jsonb_agg(to_jsonb(a)-'original_text'-'evidence_version' order by created_at,id),'[]') into reports from fyp_health_v2.reports a where project_id=any(ids);else reports:='[]';end if;
  select coalesce(jsonb_agg((to_jsonb(n)-'recipients')||jsonb_build_object('read_by',(select coalesce(jsonb_agg(student_id),'[]') from fyp_health_v2.reads where notice_id=n.id and (r='supervisor' or student_id=auth.uid()))) order by n.created_at,n.id),'[]') into notices from fyp_health_v2.notices n where n.project_id=any(ids) and (r='supervisor' or auth.uid()=any(n.recipients));
  return jsonb_build_object('actor_id',auth.uid(),'projects',projects,'reports',reports,'notices',notices);
end $$;
create function public.calculate_group_health() returns jsonb language plpgsql security definer set search_path='' as $$begin if fyp_health_v2.role()<>'supervisor' then raise exception 'Supervisor required' using errcode='42501';end if;return public.get_health_workspace();end $$;
create function public.prepare_group_health_draft(p_project_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;s fyp_health_v2.snapshots;begin p:=fyp_health_v2.project(p_project_id,true);s:=fyp_health_v2.refresh(p);return jsonb_build_object('project',p,'input',s.evidence->'input','version',s.version);end $$;
create function public.save_group_health_draft(p_project_id text,p_expected_version integer,p_health jsonb,p_text jsonb,p_source text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;s fyp_health_v2.snapshots;rid uuid;begin
  p:=fyp_health_v2.project(p_project_id,true);s:=fyp_health_v2.refresh(p);
  if s.version is distinct from p_expected_version or s.health->>'level'='green' then raise exception 'Evidence changed or no intervention is needed' using errcode='40001';end if;
  if p_health->>'level' is distinct from s.health->>'level' or jsonb_typeof(p_health->'rules') is distinct from 'array' then raise exception 'Invented health risk is forbidden' using errcode='22023';end if;
  if (select jsonb_agg(value order by value) from jsonb_array_elements(p_health->'rules')) is distinct from (select jsonb_agg(value order by value) from jsonb_array_elements(s.health->'rules')) then raise exception 'Invented health evidence is forbidden' using errcode='22023';end if;
  if p_source not in ('gemini','fallback') or p_source is null or jsonb_typeof(p_text) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_text))<>3 or not(p_text ?& array['explanation','action','message']) then raise exception 'Invalid draft text';end if;
  if exists(select 1 from jsonb_each(p_text) where jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 4000) then raise exception 'Invalid draft text bounds';end if;
  insert into fyp_health_v2.reports(project_id,risk_fingerprint,evidence_version,source,explanation,action,message,original_text) values(p_project_id,s.health->>'fingerprint',s.version,p_source,btrim(p_text->>'explanation'),btrim(p_text->>'action'),btrim(p_text->>'message'),p_text) returning id into rid;
  insert into fyp_health_v2.audit(actor,action,record_id,details) values(auth.uid(),'draft_created',rid::text,jsonb_build_object('version',s.version,'source',p_source));
  return jsonb_build_object('saved',true,'id',rid);
end $$;
create function public.review_group_health(p_report_id uuid,p_expected_version integer,p_action text,p_explanation text,p_recommended_action text,p_message text) returns jsonb language plpgsql security definer set search_path='' as $$
declare draft fyp_health_v2.reports;s fyp_health_v2.snapshots;p jsonb;members uuid[];begin
  if fyp_health_v2.role()<>'supervisor' then raise exception 'Supervisor required' using errcode='42501';end if;
  select * into draft from fyp_health_v2.reports where id=p_report_id;
  if draft.id is null then raise exception 'Report unavailable' using errcode='42501';end if;
  p:=fyp_health_v2.project(draft.project_id,true);s:=fyp_health_v2.refresh(p);
  select * into draft from fyp_health_v2.reports where id=p_report_id for update;
  if draft.status<>'draft' or draft.version is distinct from p_expected_version or draft.evidence_version<>s.version or draft.risk_fingerprint<>s.health->>'fingerprint' then raise exception 'Draft or evidence changed' using errcode='40001';end if;
  if p_action is null or p_action not in ('approve','reject') or p_explanation is null or p_recommended_action is null or p_message is null or length(btrim(p_explanation)) not between 1 and 4000 or length(btrim(p_recommended_action)) not between 1 and 4000 or length(btrim(p_message)) not between 1 and 4000 then raise exception 'Invalid review';end if;
  update fyp_health_v2.reports set status=case when p_action='approve' then 'approved' else 'rejected' end,version=version+1,reviewer_id=auth.uid(),reviewed_at=now(),explanation=btrim(p_explanation),action=btrim(p_recommended_action),message=btrim(p_message) where id=p_report_id;
  if p_action='approve' then
    select array_agg((value->>'id')::uuid) into members from jsonb_array_elements(p->'members');
    insert into fyp_health_v2.notices(report_id,project_id,body,level,recipients) values(draft.id,draft.project_id,btrim(p_message),s.health->>'level',members);
  end if;
  insert into fyp_health_v2.audit(actor,action,record_id,details) values(auth.uid(),'draft_'||p_action,p_report_id::text,jsonb_build_object('previous_version',draft.version,'edited_text',jsonb_build_object('explanation',p_explanation,'action',p_recommended_action,'message',p_message)));
  return public.get_health_workspace();
end $$;
create function public.mark_health_notice_read(p_notice_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n fyp_health_v2.notices;begin
  if fyp_health_v2.role()<>'student' then raise exception 'Recipient required' using errcode='42501';end if;
  select * into n from fyp_health_v2.notices where id=p_notice_id;
  if n.id is null or not(auth.uid()=any(n.recipients)) then raise exception 'Notice unavailable' using errcode='42501';end if;
  perform fyp_health_v2.project(n.project_id);
  insert into fyp_health_v2.reads values(n.id,auth.uid(),now()) on conflict do nothing;
  return public.get_health_workspace();
end $$;

create function public.fyp_v2_peer_workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;output jsonb:='[]';r text;begin
  r:=fyp_health_v2.role();
  for p in select value from jsonb_array_elements(fyp_health_v2.projects()) loop
    output:=output||jsonb_build_array(jsonb_build_object('id',p->>'id','title',p->>'title','members',p->'members','peers_required',coalesce((select peers_required from fyp_health_v2.settings where project_id=p->>'id'),false),'my_ratings',(select coalesce(jsonb_agg(jsonb_build_object('evaluated',evaluated,'rating',rating)),'[]') from fyp_health_v2.ratings where project_id=p->>'id' and evaluator=auth.uid()),'contribution_percents',case when r='supervisor' then (select coalesce(jsonb_agg(jsonb_build_object('student_id',student_id,'percent',percent)),'[]') from fyp_health_v2.contributions where project_id=p->>'id') else '[]'::jsonb end));
  end loop;
  return jsonb_build_object('actor_id',auth.uid(),'projects',output);
end $$;
create function public.fyp_v2_save_peer_rating(p_project_id text,p_evaluated uuid,p_rating integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;begin
  if fyp_health_v2.role()<>'student' then raise exception 'Student required' using errcode='42501';end if;
  p:=fyp_health_v2.project(p_project_id);
  perform pg_advisory_xact_lock(hashtextextended('fyp-health:'||p_project_id,0));
  if not coalesce((select peers_required from fyp_health_v2.settings where project_id=p_project_id),false) then raise exception 'Peer ratings are not open';end if;
  if p_evaluated is null or p_evaluated=auth.uid() or not exists(select 1 from jsonb_array_elements(p->'members') where value->>'id'=p_evaluated::text) then raise exception 'Choose a different group member' using errcode='42501';end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Rating must be between one and five';end if;
  insert into fyp_health_v2.ratings(project_id,evaluator,evaluated,rating) values(p_project_id,auth.uid(),p_evaluated,p_rating);
  insert into fyp_health_v2.audit(actor,action,record_id,details) values(auth.uid(),'peer_submitted',p_project_id,jsonb_build_object('evaluated',p_evaluated));
  return public.fyp_v2_peer_workspace();
end $$;
create function public.fyp_v2_set_peer_due(p_project_id text,p_required boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin
  perform fyp_health_v2.project(p_project_id,true);
  perform pg_advisory_xact_lock(hashtextextended('fyp-health:'||p_project_id,0));
  if p_required is null then raise exception 'Peer due flag is required';end if;
  insert into fyp_health_v2.settings values(p_project_id,p_required) on conflict(project_id) do update set peers_required=excluded.peers_required;
  insert into fyp_health_v2.audit(actor,action,record_id,details) values(auth.uid(),'peer_due_changed',p_project_id,jsonb_build_object('required',p_required));
  return public.fyp_v2_peer_workspace();end $$;
create function public.fyp_v2_set_contribution_percent(p_project_id text,p_student_id uuid,p_percent numeric) returns jsonb language plpgsql security definer set search_path='' as $$declare p jsonb;begin
  p:=fyp_health_v2.project(p_project_id,true);
  perform pg_advisory_xact_lock(hashtextextended('fyp-health:'||p_project_id,0));
  if p_student_id is null or not exists(select 1 from jsonb_array_elements(p->'members') where value->>'id'=p_student_id::text) then raise exception 'Student is not a group member' using errcode='42501';end if;
  if p_percent is null or p_percent not between 0 and 100 then raise exception 'Percentage must be between zero and 100';end if;
  insert into fyp_health_v2.contributions values(p_project_id,p_student_id,p_percent) on conflict(project_id,student_id) do update set percent=excluded.percent;
  insert into fyp_health_v2.audit(actor,action,record_id,details) values(auth.uid(),'contribution_percent_changed',p_project_id,jsonb_build_object('student_id',p_student_id,'percent',p_percent));
  return public.fyp_v2_peer_workspace();end $$;

revoke all on all functions in schema fyp_health_v2 from public,anon,authenticated;
do $grants$ declare f record;begin
for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_health_workspace','calculate_group_health','prepare_group_health_draft','save_group_health_draft','review_group_health','mark_health_notice_read','create_group_health_fallback','fyp_v2_peer_workspace','fyp_v2_save_peer_rating','fyp_v2_set_peer_due','fyp_v2_set_contribution_percent') loop
execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
end loop;end $grants$;
notify pgrst,'reload schema';


-- SOURCE: supabase/migrations/202610080004_assessment_v2.sql
-- Additive assessment backend built on server-authorized health evidence.
-- Defense readiness is explicitly certified by the assigned supervisor.

do $$begin
if to_regclass('fyp_health_v2.snapshots') is null then raise exception 'Install health v2 first';end if;
if exists(select 1 from pg_namespace where nspname='fyp_assessment_v2') then raise exception 'Assessment v2 already installed';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fyp_v2_assessment_workspace','fyp_v2_certify_defense','fyp_v2_schedule_defense','fyp_v2_review_peer_mark','fyp_v2_save_supervisor_marks','fyp_v2_submit_examiner_marks','fyp_v2_finalize_results','fyp_v2_release_results','fyp_v2_correct_result')) then raise exception 'Target RPC exists; inspect rather than overwrite';end if;
end $$;
create schema fyp_assessment_v2;
revoke all on schema fyp_assessment_v2 from public,anon,authenticated;
create table fyp_assessment_v2.certifications(project_id text primary key,project jsonb not null,supervisor uuid not null,certified_at timestamptz not null default now());
create table fyp_assessment_v2.defenses(id uuid primary key default gen_random_uuid(),project_id text not null unique references fyp_assessment_v2.certifications(project_id),project jsonb not null,scheduled_at timestamptz not null,location text not null check(length(btrim(location)) between 1 and 200),fee_paid boolean not null check(fee_paid),examiner_one uuid not null,examiner_two uuid not null,created_at timestamptz not null default now(),check(examiner_one<>examiner_two));
create table fyp_assessment_v2.supervisor_marks(project_id text primary key,proposal numeric(5,2) not null check(proposal between 0 and 10),progress numeric(5,2) not null check(progress between 0 and 15),individual jsonb not null,updated_at timestamptz not null default now());
create table fyp_assessment_v2.assessments(defense_id uuid not null references fyp_assessment_v2.defenses(id),examiner uuid not null,report numeric(5,2) not null check(report between 0 and 15),implementation numeric(5,2) not null check(implementation between 0 and 15),viva jsonb not null,comments text not null check(length(btrim(comments)) between 1 and 4000),submitted_at timestamptz not null default now(),primary key(defense_id,examiner));
create table fyp_assessment_v2.exclusions(project_id text not null,evaluator uuid not null,evaluated uuid not null,reason text not null,primary key(project_id,evaluator,evaluated));
create table fyp_assessment_v2.peer_reviews(project_id text not null,student_id uuid not null,signature text not null,original_mark numeric,reviewed_mark numeric not null check(reviewed_mark between 0 and 10),reason text not null,method text not null,reviewer uuid not null,reviewed_at timestamptz not null default now(),primary key(project_id,student_id));
create table fyp_assessment_v2.results(id uuid primary key default gen_random_uuid(),defense_id uuid not null references fyp_assessment_v2.defenses(id),student_id uuid not null,group_components jsonb not null,individual_components jsonb not null,group_mark numeric(5,2) not null check(group_mark between 0 and 55),individual_mark numeric(5,2) not null check(individual_mark between 0 and 45),total numeric(5,2) not null check(total between 0 and 100),version integer not null default 1,verified_by uuid not null,verified_at timestamptz not null default now(),released_at timestamptz,unique(defense_id,student_id),check(total=group_mark+individual_mark));
create table fyp_assessment_v2.audit(id bigint generated always as identity primary key,actor uuid not null,action text not null,record_id text not null,reason text,details jsonb not null,created_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['certifications','defenses','supervisor_marks','assessments','exclusions','peer_reviews','results','audit'] loop execute format('alter table fyp_assessment_v2.%I enable row level security',t);end loop;end $$;
revoke all on all tables in schema fyp_assessment_v2 from public,anon,authenticated;
revoke all on all sequences in schema fyp_assessment_v2 from public,anon,authenticated;
create function fyp_assessment_v2.coordinator() returns void language plpgsql security definer set search_path='' as $$begin if fyp_health_v2.role()<>'coordinator' then raise exception 'Coordinator required' using errcode='42501';end if;end $$;
create function fyp_assessment_v2.cached(p_id text) returns jsonb language plpgsql security definer set search_path='' as $$declare p jsonb;is_core boolean:=false;begin
if to_regclass('fyp_core_v2.groups') is not null then
 execute 'select exists(select 1 from fyp_core_v2.groups where id::text=$1)' into is_core using p_id;
 if is_core then execute 'select fyp_core_v2.project(g.id) from fyp_core_v2.groups g where g.id::text=$1 and (fyp_core_v2.proposal(g.id)).status=''approved''' into p using p_id;if p is null then raise exception 'Project is not approved';end if;return p;end if;
end if;
select evidence->'project' into p from fyp_health_v2.snapshots where project_id=p_id;
if p is null then raise exception 'Supervisor must refresh approved project evidence first';end if;return p;end $$;
create function fyp_assessment_v2.peer(p jsonb,student uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare received jsonb;av numeric;spread numeric;percent numeric;cnt int;expected int;original numeric;mark numeric;flags jsonb:='[]';sig text;review fyp_assessment_v2.peer_reviews;begin
  if not exists(select 1 from jsonb_array_elements(p->'members') where value->>'id'=student::text) then raise exception 'Other group member' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('evaluator',r.evaluator,'rating',r.rating,'excluded',e.evaluator is not null) order by r.evaluator),'[]'),avg(r.rating) into received,av from fyp_health_v2.ratings r left join fyp_assessment_v2.exclusions e using(project_id,evaluator,evaluated) where r.project_id=p->>'id' and r.evaluated=student and exists(select 1 from jsonb_array_elements(p->'members') m where m.value->>'id'=r.evaluator::text);
  original:=av/5*10;
  select count(*),avg((value->>'rating')::numeric),max((value->>'rating')::numeric)-min((value->>'rating')::numeric) into cnt,av,spread from jsonb_array_elements(received) where not(value->>'excluded')::boolean;
  select c.percent into percent from fyp_health_v2.contributions c where project_id=p->>'id' and student_id=student;
  expected:=jsonb_array_length(p->'members')-1;
  if expected=0 then flags:=flags||'"single_member_review"'::jsonb;end if;
  if expected=1 then flags:=flags||'"two_member_group"'::jsonb;end if;
  if cnt<expected or cnt=0 then flags:=flags||'"missing_rating"'::jsonb;end if;
  if av<2.5 then flags:=flags||'"low_average"'::jsonb;end if;
  if spread>=2 then flags:=flags||'"rating_spread"'::jsonb;end if;
  if percent is not null and abs(av/5*100-percent)>30 then flags:=flags||'"contribution_difference"'::jsonb;end if;
  sig:=jsonb_build_object('members',p->'members','received',received,'percent',percent)::text;
  select * into review from fyp_assessment_v2.peer_reviews where project_id=p->>'id' and student_id=student and peer_reviews.signature=sig;
  mark:=case when review.student_id is not null then review.reviewed_mark else av/5*10 end;
  return jsonb_build_object('student_id',student,'original_mark',round(original,2),'calculated_mark',round(av/5*10,2),'mark',round(mark,2),'status',case when review.student_id is not null then 'reviewed' when jsonb_array_length(flags)>0 then 'pending_review' else 'clear' end,'flags',flags,'signature',sig,'ratings',received,'reason',review.reason);
end $$;
create function fyp_assessment_v2.components(values_json jsonb,members jsonb,max_mark numeric) returns void language plpgsql set search_path='' as $$begin
if jsonb_typeof(values_json) is distinct from 'array' or jsonb_array_length(values_json)<>jsonb_array_length(members) then raise exception 'Every member needs an individual mark';end if;
if (select count(distinct value->>'student_id') from jsonb_array_elements(values_json))<>jsonb_array_length(members) or exists(select 1 from jsonb_array_elements(values_json) v where not exists(select 1 from jsonb_array_elements(members) m where m.value->>'id'=v.value->>'student_id') or jsonb_typeof(v.value->'mark') is distinct from 'number' or (v.value->>'mark')::numeric not between 0 and max_mark or (v.value->>'mark')::numeric<>round((v.value->>'mark')::numeric,2)) then raise exception 'Invalid individual components';end if;
end $$;
create function public.fyp_v2_certify_defense(p_project_id text) returns jsonb language plpgsql security definer set search_path='' as $$declare p jsonb;begin
p:=fyp_health_v2.project(p_project_id,true);perform fyp_health_v2.refresh(p);
if jsonb_array_length(p->'milestones')=0 or exists(select 1 from jsonb_array_elements(p->'milestones') where value->>'status' is distinct from 'accepted') then raise exception 'All mandatory milestones must be accepted';end if;
insert into fyp_assessment_v2.certifications values(p_project_id,p,auth.uid(),now()) on conflict(project_id) do update set project=excluded.project,supervisor=excluded.supervisor,certified_at=excluded.certified_at;
insert into fyp_assessment_v2.audit(actor,action,record_id,details) values(auth.uid(),'defense_certified',p_project_id,jsonb_build_object('project',p));
return jsonb_build_object('certified',true);end $$;
create function public.fyp_v2_schedule_defense(p_project_id text,p_scheduled_at timestamptz,p_location text,p_fee_paid boolean,p_examiner_one uuid,p_examiner_two uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare c fyp_assessment_v2.certifications;did uuid;begin
perform fyp_assessment_v2.coordinator();perform pg_advisory_xact_lock(hashtextextended('fyp-assessment:'||p_project_id,0));
select * into c from fyp_assessment_v2.certifications where project_id=p_project_id;
if c.project_id is null or c.certified_at<now()-interval '24 hours' or c.project is distinct from fyp_assessment_v2.cached(p_project_id) then raise exception 'Fresh supervisor readiness certification is required';end if;
if p_fee_paid is distinct from true then raise exception 'Fee Paid must be checked';end if;
if p_scheduled_at is null or p_scheduled_at<=now() or length(btrim(p_location)) not between 1 and 200 or p_location is null then raise exception 'Supply a future defense date and location';end if;
if p_examiner_one is null or p_examiner_two is null or p_examiner_one=p_examiner_two or (select count(*) from public.fyp_profiles where id in (p_examiner_one,p_examiner_two) and role::text='examiner')<>2 then raise exception 'Two different examiner accounts are required';end if;
insert into fyp_assessment_v2.defenses(project_id,project,scheduled_at,location,fee_paid,examiner_one,examiner_two) values(p_project_id,c.project,p_scheduled_at,btrim(p_location),true,p_examiner_one,p_examiner_two) returning id into did;
insert into fyp_assessment_v2.audit(actor,action,record_id,details) values(auth.uid(),'defense_scheduled',did::text,jsonb_build_object('examiner_one',p_examiner_one,'examiner_two',p_examiner_two,'fee_paid',true));
return jsonb_build_object('id',did);end $$;
create function public.fyp_v2_review_peer_mark(p_project_id text,p_student_id uuid,p_signature text,p_method text,p_mark numeric,p_exclude_evaluator uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare p jsonb;before_value jsonb;after_value jsonb;mark numeric;begin
perform fyp_assessment_v2.coordinator();perform pg_advisory_xact_lock(hashtextextended('fyp-health:'||p_project_id,0));
if exists(select 1 from fyp_assessment_v2.results r join fyp_assessment_v2.defenses d on r.defense_id=d.id where d.project_id=p_project_id) then raise exception 'Peer marks are frozen after result verification';end if;
p:=fyp_assessment_v2.cached(p_project_id);before_value:=fyp_assessment_v2.peer(p,p_student_id);
if before_value->>'signature' is distinct from p_signature then raise exception 'Peer evidence changed' using errcode='40001';end if;
if p_reason is null or length(btrim(p_reason)) not between 1 and 4000 or p_method is null or p_method not in ('confirm','exclude','assign') then raise exception 'A valid review method and reason are required';end if;
if p_method='exclude' then
 if p_exclude_evaluator is null or not exists(select 1 from jsonb_array_elements(before_value->'ratings') where value->>'evaluator'=p_exclude_evaluator::text) then raise exception 'Rating is not available';end if;
 insert into fyp_assessment_v2.exclusions values(p_project_id,p_exclude_evaluator,p_student_id,btrim(p_reason)) on conflict(project_id,evaluator,evaluated) do update set reason=excluded.reason;
end if;
after_value:=fyp_assessment_v2.peer(p,p_student_id);mark:=case when p_method='assign' then p_mark else (after_value->>'calculated_mark')::numeric end;
if mark is null or mark not between 0 and 10 or mark<>round(mark,2) then raise exception 'A reviewed mark between zero and ten is required';end if;
insert into fyp_assessment_v2.peer_reviews(project_id,student_id,signature,original_mark,reviewed_mark,reason,method,reviewer) values(p_project_id,p_student_id,after_value->>'signature',(before_value->>'original_mark')::numeric,mark,btrim(p_reason),p_method,auth.uid()) on conflict(project_id,student_id) do update set signature=excluded.signature,original_mark=excluded.original_mark,reviewed_mark=excluded.reviewed_mark,reason=excluded.reason,method=excluded.method,reviewer=excluded.reviewer,reviewed_at=now();
insert into fyp_assessment_v2.audit(actor,action,record_id,reason,details) values(auth.uid(),'peer_reviewed',p_project_id,btrim(p_reason),jsonb_build_object('before',before_value,'after',after_value,'reviewed_mark',mark,'method',p_method));
return jsonb_build_object('reviewed',true);end $$;
create function public.fyp_v2_save_supervisor_marks(p_project_id text,p_proposal numeric,p_progress numeric,p_individual jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare p jsonb;v jsonb;begin
p:=fyp_health_v2.project(p_project_id,true);perform pg_advisory_xact_lock(hashtextextended('fyp-assessment:'||p_project_id,0));
if exists(select 1 from fyp_assessment_v2.results r join fyp_assessment_v2.defenses d on d.id=r.defense_id where d.project_id=p_project_id) then raise exception 'Verified marks are frozen; coordinator correction requires a reason';end if;
if p_proposal is null or p_progress is null or p_proposal not between 0 and 10 or p_progress not between 0 and 15 or p_proposal<>round(p_proposal,2) or p_progress<>round(p_progress,2) then raise exception 'Invalid supervisor component maximums';end if;
perform fyp_assessment_v2.components(p_individual,p->'members',15);
insert into fyp_assessment_v2.supervisor_marks(project_id,proposal,progress,individual) values(p_project_id,p_proposal,p_progress,p_individual) on conflict(project_id) do update set proposal=excluded.proposal,progress=excluded.progress,individual=excluded.individual,updated_at=now();
for v in select value from jsonb_array_elements(p_individual) loop insert into fyp_health_v2.contributions values(p_project_id,(v->>'student_id')::uuid,round((v->>'mark')::numeric/15*100,2)) on conflict(project_id,student_id) do update set percent=excluded.percent;end loop;
perform fyp_health_v2.refresh(p);
insert into fyp_assessment_v2.audit(actor,action,record_id,details) values(auth.uid(),'supervisor_marks_saved',p_project_id,jsonb_build_object('proposal',p_proposal,'progress',p_progress,'individual',p_individual));
return jsonb_build_object('saved',true);end $$;
create function public.fyp_v2_submit_examiner_marks(p_defense_id uuid,p_report numeric,p_implementation numeric,p_viva jsonb,p_comments text) returns jsonb language plpgsql security definer set search_path='' as $$declare d fyp_assessment_v2.defenses;begin
if fyp_health_v2.role()<>'examiner' then raise exception 'Assigned examiner required' using errcode='42501';end if;
select * into d from fyp_assessment_v2.defenses where id=p_defense_id for update;
if d.id is null or auth.uid() not in (d.examiner_one,d.examiner_two) then raise exception 'Unassigned defense' using errcode='42501';end if;
if d.project is distinct from fyp_assessment_v2.cached(d.project_id) then raise exception 'Project evidence changed; recertification is required';end if;
if p_report is null or p_implementation is null or p_report not between 0 and 15 or p_implementation not between 0 and 15 or p_report<>round(p_report,2) or p_implementation<>round(p_implementation,2) or p_comments is null or length(btrim(p_comments)) not between 1 and 4000 then raise exception 'Invalid examiner components or comments';end if;
perform fyp_assessment_v2.components(p_viva,d.project->'members',20);
insert into fyp_assessment_v2.assessments values(d.id,auth.uid(),p_report,p_implementation,p_viva,btrim(p_comments),now());
insert into fyp_assessment_v2.audit(actor,action,record_id,details) values(auth.uid(),'examiner_submitted',d.id::text,jsonb_build_object('examiner',auth.uid()));return jsonb_build_object('submitted',true);end $$;
create function public.fyp_v2_finalize_results(p_defense_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d fyp_assessment_v2.defenses;sm fyp_assessment_v2.supervisor_marks;m jsonb;peer jsonb;contribution numeric;viva numeric;rep numeric;impl numeric;gm numeric;im numeric;begin
perform fyp_assessment_v2.coordinator();select * into d from fyp_assessment_v2.defenses where id=p_defense_id for update;
if d.id is null then raise exception 'Defense unavailable';end if;
perform pg_advisory_xact_lock(hashtextextended('fyp-assessment:'||d.project_id,0));perform pg_advisory_xact_lock(hashtextextended('fyp-health:'||d.project_id,0));
if d.project is distinct from fyp_assessment_v2.cached(d.project_id) or not d.fee_paid then raise exception 'Project evidence changed or fee unpaid';end if;
select * into sm from fyp_assessment_v2.supervisor_marks where project_id=d.project_id;
if sm.project_id is null then raise exception 'Supervisor marks are incomplete';end if;
if (select count(*) from fyp_assessment_v2.assessments where defense_id=d.id and examiner in (d.examiner_one,d.examiner_two))<>2 then raise exception 'Both examiners must submit';end if;
if exists(select 1 from fyp_assessment_v2.results where defense_id=d.id) then raise exception 'Results are already verified';end if;
select avg(report),avg(implementation) into rep,impl from fyp_assessment_v2.assessments where defense_id=d.id;
gm:=round(sm.proposal+sm.progress+rep+impl,2);
for m in select value from jsonb_array_elements(d.project->'members') loop
  peer:=fyp_assessment_v2.peer(d.project,(m->>'id')::uuid);if peer->>'status'='pending_review' or peer->>'mark' is null then raise exception 'Peer marks are pending review';end if;
  select (value->>'mark')::numeric into contribution from jsonb_array_elements(sm.individual) where value->>'student_id'=m->>'id';
  select avg((v.value->>'mark')::numeric) into viva from fyp_assessment_v2.assessments a cross join lateral jsonb_array_elements(a.viva) v where a.defense_id=d.id and v.value->>'student_id'=m->>'id';
  if contribution is null or viva is null then raise exception 'Individual marks are incomplete';end if;
  im:=round(contribution+viva+(peer->>'mark')::numeric,2);
  insert into fyp_assessment_v2.results(defense_id,student_id,group_components,individual_components,group_mark,individual_mark,total,verified_by) values(d.id,(m->>'id')::uuid,jsonb_build_object('proposal',sm.proposal,'progress',sm.progress,'report',rep,'implementation',impl),jsonb_build_object('contribution',contribution,'viva',viva,'peer',(peer->>'mark')::numeric),gm,im,gm+im,auth.uid());
end loop;
insert into fyp_assessment_v2.audit(actor,action,record_id,details) values(auth.uid(),'results_verified',d.id::text,jsonb_build_object('group_mark',gm,'formula','55 group + 45 individual'));return jsonb_build_object('verified',true);end $$;
create function public.fyp_v2_release_results(p_defense_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare d fyp_assessment_v2.defenses;begin
perform fyp_assessment_v2.coordinator();select * into d from fyp_assessment_v2.defenses where id=p_defense_id for update;if d.id is null then raise exception 'Defense unavailable';end if;
if (select count(*) from fyp_assessment_v2.results where defense_id=d.id)<>jsonb_array_length(d.project->'members') then raise exception 'Verified results are incomplete';end if;
update fyp_assessment_v2.results set released_at=coalesce(released_at,now()) where defense_id=d.id;
insert into fyp_assessment_v2.audit(actor,action,record_id,details) values(auth.uid(),'results_released',d.id::text,'{}');return jsonb_build_object('released',true);end $$;
create function public.fyp_v2_correct_result(p_result_id uuid,p_expected_version integer,p_group_components jsonb,p_individual_components jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare target fyp_assessment_v2.results;v jsonb;gm numeric;im numeric;old jsonb;begin
perform fyp_assessment_v2.coordinator();select * into target from fyp_assessment_v2.results where id=p_result_id;
if target.id is null then raise exception 'Result unavailable';end if;
perform 1 from fyp_assessment_v2.defenses where id=target.defense_id for update;perform 1 from fyp_assessment_v2.results where defense_id=target.defense_id order by id for update;
select * into target from fyp_assessment_v2.results where id=p_result_id;
if target.version is distinct from p_expected_version or target.released_at is null then raise exception 'Released result changed or is unavailable' using errcode='40001';end if;
if p_reason is null or length(btrim(p_reason)) not between 1 and 4000 or jsonb_typeof(p_group_components) is distinct from 'object' or jsonb_typeof(p_individual_components) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_group_components))<>4 or not(p_group_components ?& array['proposal','progress','report','implementation']) or (select count(*) from jsonb_object_keys(p_individual_components))<>3 or not(p_individual_components ?& array['contribution','viva','peer']) then raise exception 'Full valid components and correction reason are required';end if;
if exists(select 1 from jsonb_each(p_group_components) where jsonb_typeof(value)<>'number' or value::text::numeric not between 0 and case when key='proposal' then 10 else 15 end or value::text::numeric<>round(value::text::numeric,2)) or exists(select 1 from jsonb_each(p_individual_components) where jsonb_typeof(value)<>'number' or value::text::numeric not between 0 and case key when 'contribution' then 15 when 'viva' then 20 else 10 end or value::text::numeric<>round(value::text::numeric,2)) then raise exception 'Invalid corrected component maximums';end if;
select sum(value::text::numeric) into gm from jsonb_each(p_group_components);select sum(value::text::numeric) into im from jsonb_each(p_individual_components);
select jsonb_agg(to_jsonb(r)) into old from fyp_assessment_v2.results r where defense_id=target.defense_id;
update fyp_assessment_v2.results set group_components=p_group_components,group_mark=gm,total=gm+individual_mark,version=version+1 where defense_id=target.defense_id;
update fyp_assessment_v2.results set individual_components=p_individual_components,individual_mark=im,total=gm+im where id=target.id;
insert into fyp_assessment_v2.audit(actor,action,record_id,reason,details) values(auth.uid(),'released_result_corrected',target.id::text,btrim(p_reason),jsonb_build_object('previous_results',old,'group_components',p_group_components,'individual_components',p_individual_components));return jsonb_build_object('corrected',true);end $$;
create function public.fyp_v2_assessment_workspace() returns jsonb language plpgsql security definer set search_path='' as $$declare r text;p jsonb;projects jsonb:='[]';defenses jsonb;results jsonb;examiners jsonb;ids text[]:='{}';begin
r:=fyp_health_v2.role();
if r='supervisor' then for p in select value from jsonb_array_elements(fyp_health_v2.projects()) loop perform fyp_health_v2.refresh(p);ids:=array_append(ids,p->>'id');projects:=projects||jsonb_build_array(jsonb_build_object('id',p->>'id','title',p->>'title','members',p->'members','milestones',p->'milestones','supervisor_marks',(select to_jsonb(s) from fyp_assessment_v2.supervisor_marks s where project_id=p->>'id'),'certified',(select certified_at from fyp_assessment_v2.certifications where project_id=p->>'id')));end loop;
elsif r='coordinator' then for p in select evidence->'project' from fyp_health_v2.snapshots order by project_id loop ids:=array_append(ids,p->>'id');projects:=projects||jsonb_build_array(jsonb_build_object('id',p->>'id','title',p->>'title','members',p->'members','certified',(select certified_at from fyp_assessment_v2.certifications where project_id=p->>'id'),'peer_marks',(select jsonb_agg(fyp_assessment_v2.peer(p,(value->>'id')::uuid)) from jsonb_array_elements(p->'members'))));end loop;
elsif r not in ('examiner','student') then raise exception 'Role unavailable' using errcode='42501';end if;
select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'project_id',d.project_id,'title',d.project->>'title','members',d.project->'members','scheduled_at',d.scheduled_at,'location',d.location,'fee_paid',d.fee_paid,'examiner_one',d.examiner_one,'examiner_two',d.examiner_two,'my_assessment',case when r='examiner' then (select to_jsonb(a) from fyp_assessment_v2.assessments a where defense_id=d.id and examiner=auth.uid()) else null end,'submitted_examiners',case when r='coordinator' then (select coalesce(jsonb_agg(examiner),'[]') from fyp_assessment_v2.assessments where defense_id=d.id) else '[]'::jsonb end) order by d.scheduled_at),'[]') into defenses from fyp_assessment_v2.defenses d where r='coordinator' or (r='supervisor' and d.project_id=any(ids)) or (r='examiner' and auth.uid() in (d.examiner_one,d.examiner_two));
select coalesce(jsonb_agg(to_jsonb(a) order by student_id),'[]') into results from fyp_assessment_v2.results a where r='coordinator' or (r='student' and student_id=auth.uid() and released_at is not null);
if r='coordinator' then select coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name)),'[]') into examiners from public.fyp_profiles where role::text='examiner';else examiners:='[]';end if;
return jsonb_build_object('actor_id',auth.uid(),'projects',projects,'defenses',defenses,'results',results,'examiners',examiners);end $$;
revoke all on all functions in schema fyp_assessment_v2 from public,anon,authenticated;
do $$declare f record;begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fyp_v2_assessment_workspace','fyp_v2_certify_defense','fyp_v2_schedule_defense','fyp_v2_review_peer_mark','fyp_v2_save_supervisor_marks','fyp_v2_submit_examiner_marks','fyp_v2_finalize_results','fyp_v2_release_results','fyp_v2_correct_result') loop execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
notify pgrst,'reload schema';commit;


-- SOURCE: supabase/migrations/202610080005_storage_v2.sql
-- Dedicated private bucket. No existing bucket or original file is changed.

do $$begin if exists(select 1 from storage.buckets where id='fyp-v2-submissions') then raise exception 'V2 bucket already exists; inspect policies instead of reapplying';end if;end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fyp-v2-submissions','fyp-v2-submissions',false,10485760,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create function public.fyp_v2_core_file_access(p_name text,p_write boolean) returns boolean language plpgsql stable security definer set search_path='' as $$declare g uuid;r text;permitted boolean;begin
if auth.uid() is null or p_name is null then return false;end if;r:=fyp_core_v2.role();begin g:=split_part(p_name,'/',2)::uuid;exception when others then return false;end;
if p_write then return r='student' and split_part(p_name,'/',1)=auth.uid()::text and exists(select 1 from fyp_core_v2.members where group_id=g and student_id=auth.uid()) and (not exists(select 1 from fyp_core_v2.proposals where group_id=g) or (fyp_core_v2.proposal(g)).status in ('draft','changes_requested','rejected','withdrawn') or exists(select 1 from fyp_core_v2.milestones where group_id=g and status in ('not_started','needs_rework')));
end if;
if r='student' then return exists(select 1 from fyp_core_v2.members where group_id=g and student_id=auth.uid());elsif r='supervisor' then return exists(select 1 from fyp_core_v2.allocations where group_id=g and supervisor_id=auth.uid());elsif r='examiner' then select exists(select 1 from fyp_assessment_v2.defenses where project_id=g::text and auth.uid() in (examiner_one,examiner_two)) into permitted;return permitted;end if;return false;
end $$;
revoke all on function public.fyp_v2_core_file_access(text,boolean) from public;grant execute on function public.fyp_v2_core_file_access(text,boolean) to anon,authenticated;
create policy fyp_v2_private_read on storage.objects for select to authenticated using(bucket_id='fyp-v2-submissions' and public.fyp_v2_core_file_access(name,false));
create policy fyp_v2_immutable_upload on storage.objects for insert to authenticated with check(bucket_id='fyp-v2-submissions' and public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760));
-- Restrictive guards also constrain any broad legacy permissive policies.
create policy fyp_v2_guard_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'fyp-v2-submissions' or public.fyp_v2_core_file_access(name,false));
create policy fyp_v2_guard_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'fyp-v2-submissions' or (public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760)));
create policy fyp_v2_guard_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'fyp-v2-submissions') with check(bucket_id<>'fyp-v2-submissions');
create policy fyp_v2_guard_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'fyp-v2-submissions');


-- SOURCE: supabase/migrations/202610080006_cloud_safe_update.sql
-- Scoped compatibility fix for Supabase safeupdate; retains coordinator checks and locks.

create or replace function public.fyp_v2_core_configure(p_operation text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare sid uuid;uid uuid;topicids uuid[];capacity int;begin
perform fyp_core_v2.role('coordinator');perform fyp_core_v2.lock();if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid configuration';end if;
if p_operation='session' then if p_data->>'active'='true' then update fyp_core_v2.sessions set active=false where active;end if;insert into fyp_core_v2.sessions(name,active) values(p_data->>'name',coalesce((p_data->>'active')::boolean,false));
elsif p_operation='activate_session' then sid:=(p_data->>'id')::uuid;if not exists(select 1 from fyp_core_v2.sessions where id=sid) then raise exception 'Session unavailable';end if;update fyp_core_v2.sessions set active=false where active;update fyp_core_v2.sessions set active=true where id=sid;
elsif p_operation='topic' then insert into fyp_core_v2.topics(name) values(btrim(p_data->>'name'));
elsif p_operation='enroll' then sid:=(p_data->>'session_id')::uuid;uid:=(p_data->>'profile_id')::uuid;if exists(select 1 from fyp_core_v2.members m join fyp_core_v2.groups g on g.id=m.group_id join fyp_core_v2.sessions s on s.id=g.session_id where m.student_id=uid and s.active and g.session_id<>sid) then raise exception 'Grouped students cannot change active enrollment';end if;insert into fyp_core_v2.participants values(uid,sid) on conflict(profile_id,session_id) do nothing;
elsif p_operation='capacity' then sid:=(p_data->>'session_id')::uuid;uid:=(p_data->>'supervisor_id')::uuid;capacity:=(p_data->>'max_groups')::integer;if not exists(select 1 from public.fyp_profiles where id=uid and role::text='supervisor') then raise exception 'Supervisor required';end if;select coalesce(array_agg(value::text::uuid),'{}') into topicids from jsonb_array_elements_text(coalesce(p_data->'topic_ids','[]'));
if exists(select 1 from unnest(topicids) x where not exists(select 1 from fyp_core_v2.topics where id=x)) or capacity<(select count(*) from fyp_core_v2.allocations a join fyp_core_v2.groups g on g.id=a.group_id where g.session_id=sid and supervisor_id=uid) then raise exception 'Invalid topics or capacity below current workload';end if;
insert into fyp_core_v2.capacities values(sid,uid,capacity,topicids) on conflict(session_id,supervisor_id) do update set max_groups=excluded.max_groups,topic_ids=excluded.topic_ids;insert into fyp_core_v2.participants values(uid,sid) on conflict(profile_id,session_id) do nothing;
elsif p_operation='template' then if p_data->>'name' is null or length(btrim(p_data->>'name')) not between 1 and 100 or length(coalesce(p_data->>'description',''))>4000 then raise exception 'Invalid milestone template';end if;insert into fyp_core_v2.templates(session_id,name,description,days) values((p_data->>'session_id')::uuid,btrim(p_data->>'name'),coalesce(p_data->>'description',''),(p_data->>'days')::integer);
else raise exception 'Unknown configuration operation';end if;
insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'configuration_'||p_operation,coalesce(sid::text,'configuration'),p_data);return public.fyp_v2_core_configuration();end $$;



-- SOURCE: supabase/migrations/202610080007_cloud_storage_metadata.sql
-- Storage inserts may initially have null metadata. Bucket enforces MIME/10 MiB; document RPC verifies final stored size.

drop policy fyp_v2_immutable_upload on storage.objects;
drop policy fyp_v2_guard_insert on storage.objects;
create policy fyp_v2_immutable_upload on storage.objects for insert to authenticated with check(bucket_id='fyp-v2-submissions' and public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760));
create policy fyp_v2_guard_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'fyp-v2-submissions' or (public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760)));


-- SOURCE: supabase/migrations/20261010_engagement_v1.sql
-- Additive engagement features. Safe to apply to the existing project; no core records are reset.

create schema if not exists fyp_engagement_v1;
revoke all on schema fyp_engagement_v1 from public,anon,authenticated;
create table if not exists fyp_engagement_v1.enquiries(
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,
 full_name text not null check(length(btrim(full_name)) between 2 and 120),
 email text not null check(length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 plan text not null check(plan in ('Basic','Regular','Advance')),brief text not null check(length(btrim(brief)) between 20 and 6000),
 consent boolean not null check(consent),abuse_hash text not null check(length(abuse_hash)=64),
 status text not null default 'new' check(status in ('new','contacted','in_progress','completed','spam')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists enquiry_abuse_time on fyp_engagement_v1.enquiries(abuse_hash,created_at);
create index if not exists enquiry_email_time on fyp_engagement_v1.enquiries(email,created_at);
create table if not exists fyp_engagement_v1.onboarding(profile_id uuid not null references public.fyp_profiles(id),task text not null,completed boolean not null,updated_at timestamptz not null default now(),primary key(profile_id,task));
create table if not exists fyp_engagement_v1.preferences(profile_id uuid primary key references public.fyp_profiles(id),reminders_enabled boolean not null default true);
create table if not exists fyp_engagement_v1.reminders(id uuid primary key default gen_random_uuid(),recipient uuid not null references public.fyp_profiles(id),milestone_id uuid not null references fyp_core_v2.milestones(id),deadline timestamptz not null,stage text not null check(stage in ('72h','24h','overdue')),created_at timestamptz not null default now(),read_at timestamptz,unique(recipient,milestone_id,deadline,stage));
create index if not exists reminder_recipient_time on fyp_engagement_v1.reminders(recipient,created_at desc);
create table if not exists fyp_engagement_v1.reminder_runs(id bigint generated always as identity primary key,ran_at timestamptz not null default now(),inserted integer not null);
create table if not exists fyp_engagement_v1.cases(id uuid primary key default gen_random_uuid(),title text not null check(length(btrim(title)) between 3 and 160),challenge text not null check(length(btrim(challenge)) between 20 and 4000),solution text not null check(length(btrim(solution)) between 20 and 4000),outcome text not null check(length(btrim(outcome)) between 20 and 4000),evidence text not null check(length(btrim(evidence)) between 10 and 1000),image text not null default '/previews/coordinator-report.jpg' check(image in ('/previews/coordinator-report.jpg','/previews/student-workspace.png')),quote text not null default '' check(length(quote)<=1500),attribution text not null default '' check(length(attribution)<=120),consent boolean not null default false,verified boolean not null default false,published boolean not null default false,version integer not null default 1,updated_at timestamptz not null default now(),check(not published or verified),check(not published or quote='' or (consent and length(btrim(attribution))>0)));
create table if not exists fyp_engagement_v1.audit(id bigint generated always as identity primary key,actor uuid,action text not null,record_id text not null,details jsonb not null,created_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['enquiries','onboarding','preferences','reminders','reminder_runs','cases','audit'] loop execute format('alter table fyp_engagement_v1.%I enable row level security',t);end loop;end $$;
revoke all on all tables in schema fyp_engagement_v1 from public,anon,authenticated;
revoke all on all sequences in schema fyp_engagement_v1 from public,anon,authenticated;

create or replace function public.fyp_engagement_receive_enquiry(p_request_id uuid,p_name text,p_email text,p_plan text,p_brief text,p_consent boolean,p_abuse_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e fyp_engagement_v1.enquiries;begin
perform pg_advisory_xact_lock(hashtextextended('fyp-enquiry-v1',0));
if p_request_id is null or p_consent is distinct from true or length(coalesce(btrim(p_name),'')) not between 2 and 120 or length(coalesce(btrim(p_brief),'')) not between 20 and 6000 or p_plan is null or p_plan not in ('Basic','Regular','Advance') or p_email is null or length(p_email)>254 or btrim(p_email)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_abuse_hash is null or p_abuse_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid enquiry';end if;
select * into e from fyp_engagement_v1.enquiries where request_id=p_request_id;
if e.id is not null then if e.full_name<>btrim(p_name) or e.email<>lower(btrim(p_email)) or e.plan<>p_plan or e.brief<>btrim(p_brief) then raise exception 'Retry key belongs to a different request';end if;return jsonb_build_object('reference',e.id,'status','received');end if;
if (select count(*) from fyp_engagement_v1.enquiries where abuse_hash=p_abuse_hash and created_at>now()-interval '15 minutes')>=3 or (select count(*) from fyp_engagement_v1.enquiries where abuse_hash=p_abuse_hash and created_at>now()-interval '1 day')>=10 or (select count(*) from fyp_engagement_v1.enquiries where email=lower(btrim(p_email)) and created_at>now()-interval '1 day')>=3 then raise exception 'Too many enquiries. Please try again later.';end if;
insert into fyp_engagement_v1.enquiries(request_id,full_name,email,plan,brief,consent,abuse_hash) values(p_request_id,btrim(p_name),lower(btrim(p_email)),p_plan,btrim(p_brief),true,p_abuse_hash) returning * into e;
insert into fyp_engagement_v1.audit(action,record_id,details) values('enquiry_received',e.id::text,jsonb_build_object('plan',e.plan));return jsonb_build_object('reference',e.id,'status','received');end $$;

create or replace function public.fyp_engagement_public_cases() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'challenge',challenge,'solution',solution,'outcome',outcome,'evidence',evidence,'image',image,'quote',case when consent then quote else '' end,'attribution',case when consent then attribution else '' end) order by updated_at desc),'[]') from fyp_engagement_v1.cases where published and verified and (quote='' or consent)$$;

create or replace function fyp_engagement_v1.refresh_reminders(p_force boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare inserted_count integer;begin
perform pg_advisory_xact_lock(hashtextextended('fyp-reminders-v1',0));
if not p_force and exists(select 1 from fyp_engagement_v1.reminder_runs where ran_at>now()-interval '5 minutes') then return 0;end if;
with eligible as (
 select m.id,m.deadline,mem.student_id recipient from fyp_core_v2.milestones m join fyp_core_v2.groups g on g.id=m.group_id join fyp_core_v2.sessions s on s.id=g.session_id join fyp_core_v2.members mem on mem.group_id=g.id where s.active and m.status in ('not_started','needs_rework') and (fyp_core_v2.proposal(g.id)).status='approved'
 union select m.id,m.deadline,a.supervisor_id from fyp_core_v2.milestones m join fyp_core_v2.groups g on g.id=m.group_id join fyp_core_v2.sessions s on s.id=g.session_id join fyp_core_v2.allocations a on a.group_id=g.id where s.active and m.status<>'accepted' and (fyp_core_v2.proposal(g.id)).status='approved'
), fresh as (insert into fyp_engagement_v1.reminders(recipient,milestone_id,deadline,stage) select e.recipient,e.id,e.deadline,case when e.deadline>now()+interval '24 hours' then '72h' when e.deadline>now() then '24h' else 'overdue' end from eligible e left join fyp_engagement_v1.preferences p on p.profile_id=e.recipient where e.deadline<=now()+interval '72 hours' and coalesce(p.reminders_enabled,true) on conflict(recipient,milestone_id,deadline,stage) do nothing returning 1) select count(*) into inserted_count from fresh;
insert into fyp_engagement_v1.reminder_runs(inserted) values(inserted_count);return inserted_count;end $$;

create or replace function public.fyp_engagement_workspace() returns jsonb language plpgsql security definer set search_path='' as $$declare r text;result jsonb;begin
r:=fyp_core_v2.role();perform fyp_engagement_v1.refresh_reminders();
result:=jsonb_build_object('role',r,'reminders_enabled',coalesce((select reminders_enabled from fyp_engagement_v1.preferences where profile_id=auth.uid()),true),'onboarding',(select coalesce(jsonb_agg(jsonb_build_object('task',task,'completed',completed)),'[]') from fyp_engagement_v1.onboarding where profile_id=auth.uid()),'reminders',(select coalesce(jsonb_agg(x order by x.deadline),'[]') from (select n.id,n.stage,n.deadline,n.read_at,m.name,m.status,g.name group_name from fyp_engagement_v1.reminders n join fyp_core_v2.milestones m on m.id=n.milestone_id join fyp_core_v2.groups g on g.id=m.group_id join fyp_core_v2.sessions s on s.id=g.session_id where n.recipient=auth.uid() and s.active and m.status<>'accepted' and m.deadline=n.deadline and (fyp_core_v2.proposal(g.id)).status='approved' and n.stage=case when m.deadline>now()+interval '24 hours' then '72h' when m.deadline>now() then '24h' else 'overdue' end and coalesce((select reminders_enabled from fyp_engagement_v1.preferences where profile_id=auth.uid()),true) and ((r='student' and m.status in ('not_started','needs_rework') and exists(select 1 from fyp_core_v2.members where group_id=g.id and student_id=auth.uid())) or (r='supervisor' and exists(select 1 from fyp_core_v2.allocations where group_id=g.id and supervisor_id=auth.uid()))) order by n.created_at desc limit 100) x));
if r='coordinator' then result:=result||jsonb_build_object('enquiries',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]') from (select id,full_name,email,plan,brief,status,version,created_at,updated_at from fyp_engagement_v1.enquiries order by created_at desc limit 200) x),'cases',(select coalesce(jsonb_agg(to_jsonb(c) order by updated_at desc),'[]') from fyp_engagement_v1.cases c),'reminder_run',(select to_jsonb(q) from fyp_engagement_v1.reminder_runs q order by ran_at desc,id desc limit 1));end if;return result;end $$;

create or replace function public.fyp_engagement_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare r text;tasks jsonb;v uuid;begin
r:=fyp_core_v2.role();if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid request';end if;
if p_action='onboarding' then tasks:='{"student":["group","proposal","milestones","feedback","results"],"supervisor":["proposals","milestones","health","assessment"],"examiner":["defenses","assessment"],"coordinator":["configuration","matching","assessment","reports","enquiries"]}'::jsonb;
if coalesce((tasks->r ? (p_data->>'task')),false) is distinct from true or jsonb_typeof(p_data->'completed') is distinct from 'boolean' then raise exception 'Invalid onboarding task';end if;insert into fyp_engagement_v1.onboarding(profile_id,task,completed) values(auth.uid(),p_data->>'task',(p_data->>'completed')::boolean) on conflict(profile_id,task) do update set completed=excluded.completed,updated_at=now();
elsif p_action='reminders_enabled' then if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'Invalid preference';end if;insert into fyp_engagement_v1.preferences values(auth.uid(),(p_data->>'enabled')::boolean) on conflict(profile_id) do update set reminders_enabled=excluded.reminders_enabled;
elsif p_action='read_reminder' then v:=(p_data->>'id')::uuid;update fyp_engagement_v1.reminders set read_at=coalesce(read_at,now()) where id=v and recipient=auth.uid();if not found then raise exception 'Reminder unavailable' using errcode='42501';end if;
elsif p_action='enquiry_status' then perform fyp_core_v2.role('coordinator');if p_data->>'status' is null or p_data->>'status' not in ('new','contacted','in_progress','completed','spam') then raise exception 'Invalid enquiry status';end if;v:=(p_data->>'id')::uuid;update fyp_engagement_v1.enquiries set status=p_data->>'status',version=version+1,updated_at=now() where id=v and version=(p_data->>'version')::integer;if not found then raise exception 'Request changed. Refresh before updating.' using errcode='40001';end if;insert into fyp_engagement_v1.audit(actor,action,record_id,details) values(auth.uid(),'enquiry_status',v::text,jsonb_build_object('status',p_data->>'status'));
else raise exception 'Unknown action';end if;return public.fyp_engagement_workspace();end $$;

create or replace function public.fyp_engagement_save_case(p_id uuid,p_content jsonb,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$declare v uuid;begin
perform fyp_core_v2.role('coordinator');if jsonb_typeof(p_content) is distinct from 'object' or jsonb_typeof(p_content->'published') is distinct from 'boolean' or jsonb_typeof(p_content->'verified') is distinct from 'boolean' or jsonb_typeof(p_content->'consent') is distinct from 'boolean' then raise exception 'Invalid case study';end if;
if p_id is null then insert into fyp_engagement_v1.cases(title,challenge,solution,outcome,evidence,image,quote,attribution,consent,verified,published) values(btrim(p_content->>'title'),btrim(p_content->>'challenge'),btrim(p_content->>'solution'),btrim(p_content->>'outcome'),btrim(p_content->>'evidence'),p_content->>'image',coalesce(btrim(p_content->>'quote'),''),coalesce(btrim(p_content->>'attribution'),''),(p_content->>'consent')::boolean,(p_content->>'verified')::boolean,(p_content->>'published')::boolean) returning id into v;
else v:=p_id;update fyp_engagement_v1.cases set title=btrim(p_content->>'title'),challenge=btrim(p_content->>'challenge'),solution=btrim(p_content->>'solution'),outcome=btrim(p_content->>'outcome'),evidence=btrim(p_content->>'evidence'),image=p_content->>'image',quote=coalesce(btrim(p_content->>'quote'),''),attribution=coalesce(btrim(p_content->>'attribution'),''),consent=(p_content->>'consent')::boolean,verified=(p_content->>'verified')::boolean,published=(p_content->>'published')::boolean,version=version+1,updated_at=now() where id=p_id and version=p_expected_version;if not found then raise exception 'Case study changed. Refresh before updating.' using errcode='40001';end if;end if;
insert into fyp_engagement_v1.audit(actor,action,record_id,details) values(auth.uid(),'case_saved',v::text,jsonb_build_object('published',p_content->'published'));return public.fyp_engagement_workspace();end $$;

insert into fyp_engagement_v1.cases(id,title,challenge,solution,outcome,evidence,verified,published) values('00000000-0000-4000-8000-000000000901','FYP Compass: connecting the academic project journey','Keep groups, proposals, evidence and independent assessments connected while respecting each academic role.','A deployed supervision portal with supervisor matching, milestone reviews, rule-based health, confidential grading and coordinator reporting.','The implemented workflow connects proposal submission to released individual results. Screenshots show synthetic verification data, not a commercial client engagement.','Built project: FYP Compass. Implementation and verification are documented in the project handover and audit reports.',true,true) on conflict(id) do nothing;
revoke all on all functions in schema fyp_engagement_v1 from public,anon,authenticated;
revoke all on function public.fyp_engagement_receive_enquiry(uuid,text,text,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.fyp_engagement_public_cases() from public;
revoke all on function public.fyp_engagement_workspace(),public.fyp_engagement_action(text,jsonb),public.fyp_engagement_save_case(uuid,jsonb,integer) from public,anon;
grant execute on function public.fyp_engagement_public_cases() to anon,authenticated;
grant execute on function public.fyp_engagement_workspace(),public.fyp_engagement_action(text,jsonb),public.fyp_engagement_save_case(uuid,jsonb,integer) to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.fyp_engagement_receive_enquiry(uuid,text,text,text,text,boolean,text) to service_role;end if;end $$;


-- SOURCE: supabase/migrations/202610230001_prd_matching_cap.sql
-- Restore the original PRD's two-point topic tie-break cap.
-- Existing allocations and their historical explanations are preserved.

alter table fyp_core_v2.allocations
  add column if not exists topic_points integer check (topic_points between 0 and 2),
  add column if not exists shared_topic_count integer check (shared_topic_count between 0 and 3),
  add column if not exists capacity_before integer check (capacity_before > 0),
  add column if not exists lottery_used boolean;

create or replace function public.fyp_v2_core_match(p_seed text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; rank integer; c fyp_core_v2.capacities; p record; slots integer;
begin
  perform fyp_core_v2.role('coordinator');
  perform fyp_core_v2.lock();
  if p_seed is null or length(btrim(p_seed)) not between 1 and 100 then
    raise exception 'A stored matching seed is required';
  end if;
  select id into sid from fyp_core_v2.sessions where active;
  if sid is null then raise exception 'Activate a session first'; end if;
  for rank in 1..3 loop
    for c in select * from fyp_core_v2.capacities where session_id=sid order by supervisor_id loop
      select c.max_groups-count(*) into slots
      from fyp_core_v2.allocations a join fyp_core_v2.groups g on g.id=a.group_id
      where g.session_id=sid and a.supervisor_id=c.supervisor_id;
      if slots<=0 then continue; end if;
      for p in
        with candidates as (
          select pr.*, (select count(*)::integer from unnest(pr.topic_ids) x where x=any(c.topic_ids)) shared_topics
          from fyp_core_v2.proposals pr join fyp_core_v2.groups g on g.id=pr.group_id
          where g.session_id=sid and pr.status='submitted' and pr.supervisor_ids[rank]=c.supervisor_id
            and not exists(select 1 from fyp_core_v2.allocations where group_id=g.id)
        ), scored as (select *,least(2,shared_topics) tie_points from candidates)
        select *,count(*) over(partition by tie_points)>1 tied from scored
        order by tie_points desc,md5(p_seed||':'||id::text),id limit greatest(slots,0)
      loop
        insert into fyp_core_v2.allocations(group_id,supervisor_id,preference_rank,explanation,seed,
          topic_points,shared_topic_count,capacity_before,lottery_used)
        values(p.group_id,c.supervisor_id,rank,
          'Preference round '||rank||'; topic tie points '||p.tie_points||'/2 ('||p.shared_topics||
          ' shared tags); available capacity before allocation '||slots||'; seeded lottery '||
          case when p.tied then 'used' else 'not needed' end||'; stored seed '||p_seed||'.',
          p_seed,p.tie_points,p.shared_topics,slots,p.tied);
        slots:=slots-1;
      end loop;
    end loop;
  end loop;
  insert into fyp_core_v2.audit(actor,action,record_id,details)
    values(auth.uid(),'batch_matching',sid::text,jsonb_build_object('seed',p_seed,'topic_point_cap',2));
  return public.fyp_v2_core_configuration();
end$$;
revoke all on function public.fyp_v2_core_match(text) from public,anon;
grant execute on function public.fyp_v2_core_match(text) to authenticated;
notify pgrst,'reload schema';

commit;

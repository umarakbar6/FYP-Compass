-- Additive health/peer backend. Keeps all established FYP tables and RPCs intact.
-- Requires the established fyp_profiles and get_milestone_workspace contract.
-- Run as the FYP project owner. This file has not been installed remotely.
begin;
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
commit;

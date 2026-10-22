-- Additive assessment backend built on server-authorized health evidence.
-- Defense readiness is explicitly certified by the assigned supervisor.
begin;
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

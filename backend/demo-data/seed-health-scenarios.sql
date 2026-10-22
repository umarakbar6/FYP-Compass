-- Independent FYP Compass synthetic health fixtures. No Auth users or real records are changed.
-- Run only as the owner of mqzsrphoagzfmdovmukg after reviewing the synthetic profile guard.
-- Existing active session, submitted evidence and released results remain intact.
begin;
do $fixtures$
declare
  students uuid[]; supervisors uuid[]; coordinator uuid;
  v_session uuid; v_group uuid; label text;
begin
  select array_agg(id order by full_name) into students from public.fyp_profiles
    where full_name in ('Student One','Student Two','Student Three') and role='student';
  select array_agg(id order by full_name) into supervisors from public.fyp_profiles
    where full_name in ('Demo Supervisor','Demo Supervisor Two','Demo Supervisor Three') and role='supervisor';
  select id into coordinator from public.fyp_profiles where full_name='Demo Coordinator' and role='coordinator';
  if cardinality(students)<>3 or cardinality(supervisors)<>3 or coordinator is null then
    raise exception 'Expected independently provisioned synthetic demo profiles';
  end if;
  if (select count(*) from public.fyp_profiles where full_name in ('Student One','Student Two','Student Three','Demo Supervisor','Demo Supervisor Two','Demo Supervisor Three','Demo Coordinator'))<>7 then
    raise exception 'Ambiguous synthetic profile names';
  end if;
  foreach label in array array['Amber','Red'] loop
    select id into v_session from fyp_core_v2.sessions where name='Synthetic Health '||label||' Demo';
    if v_session is null then
      insert into fyp_core_v2.sessions(name,active) values('Synthetic Health '||label||' Demo',false) returning id into v_session;
    end if;
    if exists(select 1 from fyp_core_v2.sessions where id=v_session and active) then
      raise exception 'Prepared fixture session must remain inactive';
    end if;
    insert into fyp_core_v2.participants(profile_id,session_id)
      select unnest(students||supervisors),v_session on conflict do nothing;
    insert into fyp_core_v2.capacities(session_id,supervisor_id,max_groups,topic_ids)
      select v_session,unnest(supervisors),1,'{}'::uuid[] on conflict do nothing;
    select id into v_group from fyp_core_v2.groups where session_id=v_session and name='Synthetic '||label||' Health Team';
    if v_group is null then
      insert into fyp_core_v2.groups(session_id,name) values(v_session,'Synthetic '||label||' Health Team') returning id into v_group;
      insert into fyp_core_v2.members(group_id,student_id) select v_group,unnest(students);
      insert into fyp_core_v2.proposals(group_id,title,abstract,keywords,topic_ids,supervisor_ids,status,submitted_at,review,started_at)
        values(v_group,'Synthetic '||label||' Health Evidence','Prepared synthetic health-rule scenario for hackathon demonstration. No real academic decision.','{synthetic,health}','{}',supervisors,'approved',now(),jsonb_build_object('action','approve','comment','Prepared synthetic fixture only.','reviewer_id',supervisors[1]),now());
      insert into fyp_core_v2.allocations(group_id,supervisor_id,preference_rank,explanation,seed)
        values(v_group,supervisors[1],1,'Prepared synthetic health fixture; assigned within separate-session capacity.','synthetic-health-fixture');
      insert into fyp_core_v2.milestones(group_id,name,description,deadline,status)
        values(v_group,'Synthetic health deadline','Unsubmitted prepared evidence: upcoming yields Amber; overdue yields Red.',now()+case when label='Amber' then interval '2 days' else interval '-1 day' end,'not_started');
      insert into fyp_core_v2.audit(actor,action,record_id,details)
        values(coordinator,'synthetic_health_fixture_created',v_group::text,jsonb_build_object('label',label,'synthetic',true));
    elsif (select count(*) from fyp_core_v2.members where group_id=v_group and student_id=any(students))<>3
       or (select count(*) from fyp_core_v2.members where group_id=v_group)<>3 then
      raise exception 'Existing fixture membership differs; no changes applied';
    end if;
  end loop;
end $fixtures$;
commit;

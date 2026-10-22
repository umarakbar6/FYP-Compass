
-- Parallel independent group writes; coordinator configuration/matching retains an exclusive barrier.
begin;
create or replace function fyp_core_v2.lock_scope(p_scope text)
returns void language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('fyp-core-v2',0));
 perform pg_advisory_xact_lock(hashtextextended('fyp-core-scope:'||coalesce(p_scope,'unknown'),0));
end $$;
create or replace function fyp_core_v2.lock_members(p_members uuid[])
returns void language plpgsql set search_path='' as $$
declare person uuid;begin
 perform pg_advisory_xact_lock_shared(hashtextextended('fyp-core-v2',0));
 for person in select distinct unnest(p_members) order by 1 loop
 perform pg_advisory_xact_lock(hashtextextended('fyp-core-member:'||person::text,0));
 end loop;
end $$;
revoke all on function fyp_core_v2.lock_scope(text),fyp_core_v2.lock_members(uuid[]) from public,anon,authenticated;
do $$declare item record;definition text;replacement text;begin
 for item in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('fyp_v2_core_create_student_group','fyp_v2_core_save_student_proposal','fyp_v2_core_run_similarity_screen','fyp_v2_core_review_supervisor_proposal',
 'fyp_v2_core_submit_student_milestone','fyp_v2_core_save_milestone_contribution','fyp_v2_core_review_supervisor_milestone') loop
 definition:=pg_get_functiondef(item.oid);
 if item.proname='fyp_v2_core_create_student_group' then replacement:='perform fyp_core_v2.lock_members(array_prepend(auth.uid(),coalesce(p_member_ids,''{}'')));';
 elsif item.proname='fyp_v2_core_save_student_proposal' then replacement:='perform fyp_core_v2.lock_scope(''group:''||p_group_id::text);';
 elsif item.proname in ('fyp_v2_core_run_similarity_screen','fyp_v2_core_review_supervisor_proposal') then
 replacement:='perform fyp_core_v2.lock_scope(''group:''||(select group_id::text from fyp_core_v2.proposals where id=p_proposal_id));';
 else replacement:='perform fyp_core_v2.lock_scope(''group:''||(select group_id::text from fyp_core_v2.milestones where id=p_milestone_id));';end if;
 definition:=replace(definition,'perform fyp_core_v2.lock();',replacement);
 execute definition;
 end loop;
end $$;
commit;

-- Restore the original PRD's two-point topic tie-break cap.
-- Existing allocations and their historical explanations are preserved.
begin;
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

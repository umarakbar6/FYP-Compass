begin;
create or replace function public.fyp_coordinator_health(p_session_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; projects jsonb; notices jsonb;
begin
 perform fyp_core_v2.role('coordinator');
 if p_session_id is null then select id into sid from fyp_core_v2.sessions where active;
 else select id into sid from fyp_core_v2.sessions where id=p_session_id;
 if sid is null then raise exception 'Session unavailable' using errcode='22023';end if;end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',g.id,'name',g.name,'title',p.title,'supervisor_name',prof.full_name,'health',h.health,
  'draft_count',(select count(*) from fyp_health_v2.reports r where r.project_id=g.id::text and r.status='draft')
 ) order by g.name,g.id),'[]'::jsonb) into projects
 from fyp_core_v2.groups g join fyp_core_v2.proposals p on p.group_id=g.id and p.status='approved'
 left join fyp_core_v2.allocations a on a.group_id=g.id left join public.fyp_profiles prof on prof.id=a.supervisor_id
 left join fyp_health_v2.snapshots h on h.project_id=g.id::text where g.session_id=sid;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) into notices from (
  select n.id,g.name project_name,n.body,n.level,r.source,n.created_at,cardinality(n.recipients) recipients_count,
   (select count(*) from fyp_health_v2.reads rd where rd.notice_id=n.id) read_count
  from fyp_health_v2.notices n join fyp_core_v2.groups g on g.id::text=n.project_id
  join fyp_health_v2.reports r on r.id=n.report_id and r.status='approved'
  where g.session_id=sid order by n.created_at desc,n.id limit 200
 ) x;
 return jsonb_build_object('actor_id',auth.uid(),'selected_session',sid,
  'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by active desc,name),'[]'::jsonb) from fyp_core_v2.sessions),
  'projects',projects,'notices',notices);
end $$;
revoke all on function public.fyp_coordinator_health(uuid) from public,anon;
grant execute on function public.fyp_coordinator_health(uuid) to authenticated;
commit;

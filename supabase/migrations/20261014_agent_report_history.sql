-- Persist the complete bounded source screening preview so an authorized actor can reopen and export it.
begin;
alter table fyp_agents_v1.runs add column if not exists report jsonb;
create or replace function public.fyp_agents_finish(p_id uuid,p_actor uuid,p_draft jsonb,p_source text,p_report jsonb)
returns void language plpgsql security definer set search_path='' as $$begin
 if p_actor is null or p_source is null or p_source not in ('gemini','failed') or (p_source='failed' and (p_draft is not null or p_report is not null)) or (p_source='gemini' and (jsonb_typeof(p_draft) is distinct from 'object' or length(p_draft::text)>50000)) then raise exception 'Invalid result' using errcode='22023';end if;
 if p_report is not null and (jsonb_typeof(p_report)<>'object' or length(p_report::text)>100000 or p_report->>'checkedAt' is null or jsonb_typeof(p_report->'sources')<>'array' or jsonb_array_length(p_report->'sources')>12 or jsonb_typeof(p_report->'providers')<>'array') then raise exception 'Invalid source report' using errcode='22023';end if;
 update fyp_agents_v1.runs set draft=p_draft,report=p_report,source=p_source,status=case when p_source='gemini' then 'draft' else 'failed' end,finished_at=now()
 where id=p_id and actor=p_actor and status='reserved' and (p_source='failed' or fyp_agents_v1.allowed(actor,kind,project_id,scope_projects));if not found then raise exception 'Reservation unavailable' using errcode='42501';end if;
end$$;
create or replace function public.fyp_agents_history() returns jsonb language plpgsql security definer set search_path='' as $$begin perform fyp_core_v2.role();return (select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc),'[]') from(select id,kind,project_id,status,source,draft,report,created_at from fyp_agents_v1.runs where actor=auth.uid() and fyp_agents_v1.allowed(actor,kind,project_id,scope_projects) order by created_at desc limit 50)r);end$$;
revoke all on function public.fyp_agents_finish(uuid,uuid,jsonb,text,jsonb),public.fyp_agents_history() from public,anon,authenticated;
grant execute on function public.fyp_agents_finish(uuid,uuid,jsonb,text,jsonb) to service_role;
grant execute on function public.fyp_agents_history() to authenticated;
notify pgrst,'reload schema';commit;

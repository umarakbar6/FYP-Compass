
begin;
create schema if not exists fyp_agents_v1;
revoke all on schema fyp_agents_v1 from public,anon,authenticated;
create table if not exists fyp_agents_v1.runs(
 id uuid primary key default gen_random_uuid(),actor uuid not null references public.fyp_profiles(id),
 kind text not null check(kind in ('matching','proposal','document','nudge','digest','scheduler','report','support','qa')),
 project_id uuid references fyp_core_v2.groups(id),scope_projects uuid[] not null default '{}',status text not null default 'reserved' check(status in ('reserved','draft','failed')),
 source text not null default 'pending',draft jsonb,evidence_hash text not null,created_at timestamptz not null default now(),finished_at timestamptz);
alter table fyp_agents_v1.runs enable row level security;
revoke all on fyp_agents_v1.runs from public,anon,authenticated;
create index if not exists agent_project on fyp_agents_v1.runs(project_id);
create index if not exists agent_actor_time on fyp_agents_v1.runs(actor,created_at);
create or replace function public.fyp_agents_context(p_kind text,p_project_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;g fyp_core_v2.groups;p fyp_core_v2.proposals;result jsonb;report jsonb;begin
 r:=fyp_core_v2.role();
 if p_kind not in ('proposal','document') and p_project_id is not null then raise exception 'Invalid project override' using errcode='22023';end if;
 if p_kind is null or p_kind not in ('matching','proposal','document','nudge','digest','scheduler','report','support','qa') then raise exception 'Unknown agent' using errcode='22023';end if;
 if p_kind in ('matching','scheduler','report','qa') and r<>'coordinator' then raise exception 'Coordinator agent only' using errcode='42501';end if;
 if p_kind='digest' and r<>'supervisor' then raise exception 'Supervisor digest only' using errcode='42501';end if;
 if p_kind in ('proposal','document') then
 if p_project_id is null then raise exception 'Choose a project' using errcode='22023';end if;
 perform fyp_core_v2.authorize(p_project_id);
 select * into g from fyp_core_v2.groups where id=p_project_id;
 p:=fyp_core_v2.proposal(g.id);
 result:=jsonb_build_object('project_id',g.id,'proposal',jsonb_build_object('source_version',md5(p.title||chr(10)||p.abstract),'id',p.id,'title',p.title,'abstract',p.abstract,'keywords',p.keywords,'topic_ids',p.topic_ids),
 'milestones',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'description',m.description,'deadline',m.deadline,'status',m.status)),'[]') from fyp_core_v2.milestones m where group_id=g.id),
 'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from (select s.id,s.milestone_id,s.submitted_at,s.document from fyp_core_v2.submissions s join fyp_core_v2.milestones m on m.id=s.milestone_id where m.group_id=g.id and s.milestone_id=(select ss.milestone_id from fyp_core_v2.submissions ss join fyp_core_v2.milestones mm on mm.id=ss.milestone_id where mm.group_id=g.id order by ss.submitted_at desc,ss.id desc limit 1) order by s.submitted_at desc,s.id desc limit 2)d),
 'comparison_proposals',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select pr.id,pr.title,pr.abstract,md5(pr.title||chr(10)||pr.abstract)as source_version from fyp_core_v2.proposals pr
 join fyp_core_v2.groups gr on gr.id=pr.group_id where gr.session_id=g.session_id and pr.status<>'draft' and pr.id<>p.id
 and (r='supervisor' and exists(select 1 from fyp_core_v2.allocations a where a.group_id=gr.id and a.supervisor_id=auth.uid())) order by pr.id limit 5)x));
 elsif p_kind='nudge' then result:=public.fyp_reminders_page(null,null,50);
 elsif p_kind='digest' then result:=(public.get_health_workspace()-'reports'-'notices')||jsonb_build_object('window_start',now()-interval '7 days','window_end',now(),'scope','Weekly attention draft from current authorized snapshots, not a historical change log');
 elsif p_kind='report' then result:=public.fyp_reports_page(null,null,1)-'rows';
 elsif p_kind in ('matching','scheduler') then
 report:=public.fyp_v2_core_accreditation();
 result:=report-'people'-'results'-'audit'-'assessment_audit'-'peer_reviews';
 if p_kind='report' then result:=result||jsonb_build_object('sql_totals',jsonb_build_object('groups',jsonb_array_length(report->'groups'),'milestones',jsonb_array_length(report->'milestones'),'defenses',jsonb_array_length(report->'defenses'),'results',jsonb_array_length(report->'results'),'released_results',(select count(*) from jsonb_array_elements(report->'results') x where x->>'released_at' is not null)));end if;
 if p_kind='matching' then result:=result||jsonb_build_object('expertise',(select coalesce(jsonb_agg(jsonb_build_object('supervisor_id',c.supervisor_id,'topic_ids',c.topic_ids,'max_groups',c.max_groups)),'[]') from fyp_core_v2.capacities c join fyp_core_v2.sessions s on s.id=c.session_id where s.active),
 'proposal_text',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'group_id',p.group_id,'title',p.title,'abstract',p.abstract)),'[]') from fyp_core_v2.proposals p join fyp_core_v2.groups g on g.id=p.group_id join fyp_core_v2.sessions s on s.id=g.session_id where s.active and p.status in ('submitted','approved') order by p.id limit 20));
 end if;
 if p_kind='scheduler' then result:=result||jsonb_build_object('availability',(public.fyp_schedule_availability_workspace())->'windows','examiners',(select coalesce(jsonb_agg(id),'[]') from public.fyp_profiles where role='examiner'),
 'readiness',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'supervisor_id',a.supervisor_id,'ready',exists(select 1 from fyp_assessment_v2.certifications c where c.project_id=g.id::text)
 and not exists(select 1 from fyp_core_v2.milestones m where m.group_id=g.id and m.status<>'accepted'))),'[]') from fyp_core_v2.groups g join fyp_core_v2.sessions s on s.id=g.session_id left join fyp_core_v2.allocations a on a.group_id=g.id where s.active));
 end if;
 elsif p_kind='support' then result:=jsonb_build_object('role',r,'knowledge',jsonb_build_array('Accounts are invited by the coordinator; recovery is available through Forgot your password and requires configured email delivery.','Groups contain one to three enrolled students.','Proposals require three distinct supervisor preferences and up to three controlled topics.','Milestones require verified PDF or DOCX evidence and individual contribution statements.','Health levels come from fixed rules. AI drafts require supervisor approval.','Results are private until coordinator release.','Pricing enquiries do not take payment. Reminders are in-app and can be disabled.','Escalate unknown private-record or policy questions to the coordinator.'));
 else result:=jsonb_build_object('application','FYP Compass','scope','Code review suggestions only; CI execution evidence must be supplied by the release workflow.');
 end if;
 return jsonb_build_object('actor_id',auth.uid(),'role',r,'kind',p_kind,'snapshot_at',now(),'evidence',result);
end $$;

create or replace function fyp_agents_v1.allowed(p_actor uuid,p_kind text,p_project uuid,p_scope uuid[])returns boolean language sql stable security definer set search_path='' as $$
select coalesce((case p.role::text
 when 'student' then p_kind in ('proposal','document','nudge','support')
 when 'supervisor' then p_kind in ('proposal','document','nudge','digest','support')
 when 'examiner' then p_kind='support'
 when 'coordinator' then p_kind in ('matching','scheduler','report','support','qa')else false end)
 and not exists(select 1 from unnest(coalesce(p_scope,'{}'::uuid[])||case when p_project is null then '{}'::uuid[]else array[p_project]end)g
 where not ((p.role::text='student'and exists(select 1 from fyp_core_v2.members m where m.group_id=g and m.student_id=p_actor))
 or (p.role::text='supervisor'and exists(select 1 from fyp_core_v2.allocations a where a.group_id=g and a.supervisor_id=p_actor))
 or p.role::text='coordinator')),false)from public.fyp_profiles p where p.id=p_actor
$$;
revoke all on function fyp_agents_v1.allowed(uuid,text,uuid,uuid[])from public,anon,authenticated;

create or replace function public.fyp_agents_reserve(p_kind text,p_project_id uuid,p_evidence_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid;scope uuid[];begin
 perform public.fyp_agents_context(p_kind,p_project_id);
 if p_evidence_hash is null or p_evidence_hash !~'^[a-f0-9]{64}$' then raise exception 'Invalid evidence hash' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-agents-budget',0));
 if (select count(*) from fyp_agents_v1.runs where actor=auth.uid() and created_at>now()-interval '15 minutes')>=5
 or (select count(*) from fyp_agents_v1.runs where actor=auth.uid() and created_at>now()-interval '1 day')>=20
 or (select count(*) from fyp_agents_v1.runs where created_at>now()-interval '1 day')>=100 then raise exception 'Agent request limit reached' using errcode='P0429';end if;
 if p_project_id is not null then scope:=array[p_project_id];
 elsif p_kind in ('digest','nudge')then select coalesce(array_agg(g.id),'{}')into scope from fyp_core_v2.groups g
 where exists(select 1 from fyp_core_v2.members m where m.group_id=g.id and m.student_id=auth.uid())or exists(select 1 from fyp_core_v2.allocations a where a.group_id=g.id and a.supervisor_id=auth.uid());
 else scope:='{}';end if;
 insert into fyp_agents_v1.runs(actor,kind,project_id,evidence_hash,scope_projects) values(auth.uid(),p_kind,p_project_id,p_evidence_hash,scope) returning id into v;return v;
end $$;
create or replace function public.fyp_agents_finish(p_id uuid,p_actor uuid,p_draft jsonb,p_source text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_actor is null or p_source is null or p_source not in ('gemini','failed') or (p_source='failed'and p_draft is not null) or (p_source='gemini' and (jsonb_typeof(p_draft) is distinct from 'object' or length(p_draft::text)>50000)) then raise exception 'Invalid result' using errcode='22023';end if;
 update fyp_agents_v1.runs set draft=p_draft,source=p_source,status=case when p_source='gemini' then 'draft' else 'failed' end,finished_at=now()
 where id=p_id and actor=p_actor and status='reserved' and (p_source='failed'or fyp_agents_v1.allowed(actor,kind,project_id,scope_projects));
 if not found then raise exception 'Reservation unavailable' using errcode='42501';end if;
end $$;
create or replace function public.fyp_agents_history() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform fyp_core_v2.role();
 return (select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc),'[]') from
 (select id,kind,project_id,status,source,draft,created_at from fyp_agents_v1.runs where actor=auth.uid() and fyp_agents_v1.allowed(actor,kind,project_id,scope_projects) order by created_at desc limit 50)r);
end $$;
revoke all on function public.fyp_agents_context(text,uuid),public.fyp_agents_reserve(text,uuid,text),public.fyp_agents_finish(uuid,uuid,jsonb,text),public.fyp_agents_history() from public,anon,authenticated;
grant execute on function public.fyp_agents_context(text,uuid),public.fyp_agents_reserve(text,uuid,text),public.fyp_agents_history() to authenticated;
grant execute on function public.fyp_agents_finish(uuid,uuid,jsonb,text) to service_role;
commit;

-- Resolve PL/pgSQL record aliases and bound proposal rows before aggregation.
begin;
create or replace function public.fyp_agents_context(p_kind text,p_project_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;v_group fyp_core_v2.groups;v_proposal fyp_core_v2.proposals;result jsonb;report jsonb;begin
 r:=fyp_core_v2.role();
 if p_kind not in ('proposal','document') and p_project_id is not null then raise exception 'Invalid project override' using errcode='22023';end if;
 if p_kind is null or p_kind not in ('matching','proposal','document','nudge','digest','scheduler','report','support','qa') then raise exception 'Unknown agent' using errcode='22023';end if;
 if p_kind in ('matching','scheduler','report','qa') and r<>'coordinator' then raise exception 'Coordinator agent only' using errcode='42501';end if;
 if p_kind='digest' and r<>'supervisor' then raise exception 'Supervisor digest only' using errcode='42501';end if;
 if p_kind in ('proposal','document') then
 if p_project_id is null then raise exception 'Choose a project' using errcode='22023';end if;
 perform fyp_core_v2.authorize(p_project_id);
 select * into v_group from fyp_core_v2.groups where id=p_project_id;
 v_proposal:=fyp_core_v2.proposal(v_group.id);
 result:=jsonb_build_object('project_id',v_group.id,'proposal',jsonb_build_object('source_version',md5(v_proposal.title||chr(10)||v_proposal.abstract),'id',v_proposal.id,'title',v_proposal.title,'abstract',v_proposal.abstract,'keywords',v_proposal.keywords,'topic_ids',v_proposal.topic_ids),
 'milestones',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'description',m.description,'deadline',m.deadline,'status',m.status)),'[]') from fyp_core_v2.milestones m where group_id=v_group.id),
 'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from (select s.id,s.milestone_id,s.submitted_at,s.document from fyp_core_v2.submissions s join fyp_core_v2.milestones m on m.id=s.milestone_id where m.group_id=v_group.id and s.milestone_id=(select ss.milestone_id from fyp_core_v2.submissions ss join fyp_core_v2.milestones mm on mm.id=ss.milestone_id where mm.group_id=v_group.id order by ss.submitted_at desc,ss.id desc limit 1) order by s.submitted_at desc,s.id desc limit 2)d),
 'comparison_proposals',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select pr.id,pr.title,pr.abstract,md5(pr.title||chr(10)||pr.abstract)as source_version from fyp_core_v2.proposals pr
 join fyp_core_v2.groups gr on gr.id=pr.group_id where gr.session_id=v_group.session_id and pr.status<>'draft' and pr.id<>v_proposal.id
 and (r='supervisor' and exists(select 1 from fyp_core_v2.allocations a where a.group_id=gr.id and a.supervisor_id=auth.uid())) order by pr.id limit 5)x));
 elsif p_kind='nudge' then result:=public.fyp_reminders_page(null,null,50);
 elsif p_kind='digest' then result:=(public.get_health_workspace()-'reports'-'notices')||jsonb_build_object('window_start',now()-interval '7 days','window_end',now(),'scope','Weekly attention draft from current authorized snapshots, not a historical change log');
 elsif p_kind='report' then result:=public.fyp_reports_page(null,null,1)-'rows';
 elsif p_kind in ('matching','scheduler') then
 report:=public.fyp_v2_core_accreditation();
 result:=report-'people'-'results'-'audit'-'assessment_audit'-'peer_reviews';
 if p_kind='report' then result:=result||jsonb_build_object('sql_totals',jsonb_build_object('groups',jsonb_array_length(report->'groups'),'milestones',jsonb_array_length(report->'milestones'),'defenses',jsonb_array_length(report->'defenses'),'results',jsonb_array_length(report->'results'),'released_results',(select count(*) from jsonb_array_elements(report->'results') x where x->>'released_at' is not null)));end if;
 if p_kind='matching' then result:=result||jsonb_build_object('expertise',(select coalesce(jsonb_agg(jsonb_build_object('supervisor_id',c.supervisor_id,'topic_ids',c.topic_ids,'max_groups',c.max_groups)),'[]') from fyp_core_v2.capacities c join fyp_core_v2.sessions s on s.id=c.session_id where s.active),
 'proposal_text',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from (select pr.id,pr.group_id,pr.title,pr.abstract from fyp_core_v2.proposals pr join fyp_core_v2.groups gr on gr.id=pr.group_id join fyp_core_v2.sessions ss on ss.id=gr.session_id where ss.active and pr.status in ('submitted','approved') order by pr.id limit 20)x));
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

commit;

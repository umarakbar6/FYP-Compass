begin;
create or replace function fyp_engagement_v1.eligible_reminders(p_actor uuid)
returns table(id uuid,recipient uuid,stage text,deadline timestamptz,read_at timestamptz,name text,status text,group_name text,created_at timestamptz)
language sql security definer set search_path='' as $$
 select n.id,n.recipient,n.stage,n.deadline,n.read_at,m.name,m.status,g.name,n.created_at
 from fyp_engagement_v1.reminders n join public.fyp_profiles pr on pr.id=n.recipient join fyp_core_v2.milestones m on m.id=n.milestone_id
 join fyp_core_v2.groups g on g.id=m.group_id join fyp_core_v2.sessions s on s.id=g.session_id
 where n.recipient=p_actor and s.active and m.status<>'accepted' and m.deadline=n.deadline and (fyp_core_v2.proposal(g.id)).status='approved'
 and n.stage=case when m.deadline>now()+interval '24 hours' then '72h' when m.deadline>now() then '24h' else 'overdue' end
 and coalesce((select reminders_enabled from fyp_engagement_v1.preferences where profile_id=p_actor),true)
 and ((pr.role='student' and m.status in ('not_started','needs_rework') and exists(select 1 from fyp_core_v2.members where group_id=g.id and student_id=p_actor))
 or (pr.role='supervisor' and exists(select 1 from fyp_core_v2.allocations where group_id=g.id and supervisor_id=p_actor)));$$;
revoke all on function fyp_engagement_v1.eligible_reminders(uuid) from public,anon,authenticated;
create or replace function public.fyp_reminders_page(p_before_time timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;begin
 perform fyp_core_v2.role();perform fyp_engagement_v1.refresh_reminders();
 if p_limit is null or p_limit not between 1 and 50 or (p_before_time is null)<>(p_before_id is null)then raise exception 'Invalid page' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id desc),'[]')into rows from (select * from fyp_engagement_v1.eligible_reminders(auth.uid())where p_before_id is null or (created_at,id)<(p_before_time,p_before_id)order by created_at desc,id desc limit p_limit)x;
 return jsonb_build_object('rows',rows,'total',(select count(*)from fyp_engagement_v1.eligible_reminders(auth.uid())),
 'has_more',exists(select 1 from fyp_engagement_v1.eligible_reminders(auth.uid())where (created_at,id)<((rows->(jsonb_array_length(rows)-1)->>'created_at')::timestamptz,(rows->(jsonb_array_length(rows)-1)->>'id')::uuid)));
end $$;
create table if not exists fyp_ops_v1.reminder_deliveries(id uuid primary key default gen_random_uuid(),recipient uuid not null references public.fyp_profiles(id),reminder_id uuid not null references fyp_engagement_v1.reminders(id),run_id uuid not null references fyp_agents_v1.runs(id),status text not null default 'reserved' check(status in ('reserved','sent','failed')),created_at timestamptz not null default now(),finished_at timestamptz,unique(recipient,reminder_id));
alter table fyp_ops_v1.reminder_deliveries enable row level security;
revoke all on fyp_ops_v1.reminder_deliveries from public,anon,authenticated;
create index if not exists reminder_delivery_run on fyp_ops_v1.reminder_deliveries(run_id);
create index if not exists reminder_delivery_reminder on fyp_ops_v1.reminder_deliveries(reminder_id);
create or replace function public.fyp_reminder_delivery_prepare(p_reminder_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reminder record;draft text;delivery fyp_ops_v1.reminder_deliveries;begin
 perform fyp_core_v2.role();perform fyp_engagement_v1.refresh_reminders();
 select * into reminder from fyp_engagement_v1.eligible_reminders(auth.uid())where id=p_reminder_id;
 if reminder.id is null then raise exception 'Reminder is no longer eligible' using errcode='42501';end if;
 select r.draft->>'summary' into draft from fyp_agents_v1.runs r where r.id=p_run_id and r.actor=auth.uid()and r.kind='nudge'and r.status='draft'and r.source='gemini';
 if draft is null or length(draft)>4000 then raise exception 'Approve your own verified reminder draft first' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-reminder-delivery-global-budget',0));
 perform pg_advisory_xact_lock(hashtextextended('fyp-reminder-delivery:'||auth.uid()::text,0));
 if not exists(select 1 from fyp_ops_v1.reminder_deliveries where recipient=auth.uid()and reminder_id=p_reminder_id)and ((select count(*)from fyp_ops_v1.reminder_deliveries where recipient=auth.uid()and created_at>now()-interval '1 day')>=10 or(select count(*)from fyp_ops_v1.reminder_deliveries where created_at>now()-interval '1 day')>=100)then raise exception 'Delivery limit reached'using errcode='P0429';end if;
 insert into fyp_ops_v1.reminder_deliveries(recipient,reminder_id,run_id)values(auth.uid(),p_reminder_id,p_run_id)on conflict(recipient,reminder_id)do nothing;
 select * into delivery from fyp_ops_v1.reminder_deliveries where recipient=auth.uid()and reminder_id=p_reminder_id;
 if delivery.run_id<>p_run_id then raise exception 'This reminder already has a delivery draft' using errcode='22023';end if;
 return jsonb_build_object('id',delivery.id,'status',delivery.status,'created_at',delivery.created_at,'name',reminder.name,'deadline',reminder.deadline,'stage',reminder.stage,'group_name',reminder.group_name,'text',draft);
end $$;
create or replace function public.fyp_reminder_delivery_finish(p_id uuid,p_actor uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$begin
 if p_status not in ('sent','failed')then raise exception 'Invalid delivery status' using errcode='22023';end if;
 update fyp_ops_v1.reminder_deliveries set status=p_status,finished_at=now()where id=p_id and recipient=p_actor and status in ('reserved','failed');
 if not found then raise exception 'Delivery unavailable' using errcode='42501';end if;end $$;
revoke all on function public.fyp_reminders_page(timestamptz,uuid,integer),public.fyp_reminder_delivery_prepare(uuid,uuid),public.fyp_reminder_delivery_finish(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.fyp_reminders_page(timestamptz,uuid,integer),public.fyp_reminder_delivery_prepare(uuid,uuid)to authenticated;
grant execute on function public.fyp_reminder_delivery_finish(uuid,uuid,text)to service_role;
commit;

begin;
alter table fyp_ops_v1.reminder_deliveries add column if not exists smtp_attempted_at timestamptz;
create or replace function public.fyp_reminder_smtp_claim(p_id uuid,p_actor uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare d fyp_ops_v1.reminder_deliveries;begin
 select * into d from fyp_ops_v1.reminder_deliveries where id=p_id and recipient=p_actor for update;
 if d.id is null or not exists(select 1 from fyp_engagement_v1.eligible_reminders(p_actor) where id=d.reminder_id) then raise exception 'Reminder is no longer eligible' using errcode='42501';end if;
 if not exists(select 1 from fyp_agents_v1.runs r where r.id=d.run_id and r.actor=p_actor and r.kind='nudge' and r.status='draft' and r.source='gemini' and length(r.draft->>'summary') between 1 and 4000) then raise exception 'Draft is no longer eligible' using errcode='42501';end if;
 if d.status<>'reserved' or d.smtp_attempted_at is not null then return false;end if;
 update fyp_ops_v1.reminder_deliveries set smtp_attempted_at=now() where id=p_id;return true;
end $$;
create table if not exists fyp_ops_v1.email_tests(id uuid primary key,actor uuid not null references public.fyp_profiles(id),status text not null default 'reserved' check(status in ('reserved','sent','failed')),created_at timestamptz not null default now(),attempted_at timestamptz,finished_at timestamptz);
alter table fyp_ops_v1.email_tests enable row level security;
revoke all on fyp_ops_v1.email_tests from public,anon,authenticated;
create index if not exists email_test_actor_created on fyp_ops_v1.email_tests(actor,created_at);
create or replace function public.fyp_email_test_prepare(p_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d fyp_ops_v1.email_tests;claimed boolean:=false;begin
 if not exists(select 1 from public.fyp_profiles where id=p_actor and role='coordinator') then raise exception 'Coordinator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-email-test:'||p_actor::text,0));
 if not exists(select 1 from fyp_ops_v1.email_tests where id=p_id) and (select count(*) from fyp_ops_v1.email_tests where actor=p_actor and created_at>now()-interval '1 day')>=3 then raise exception 'Email test limit reached' using errcode='P0429';end if;
 insert into fyp_ops_v1.email_tests(id,actor) values(p_id,p_actor) on conflict(id) do nothing;
 select * into d from fyp_ops_v1.email_tests where id=p_id and actor=p_actor for update;
 if d.id is null then raise exception 'Request belongs to another account' using errcode='42501';end if;
 if d.status='reserved' and d.attempted_at is null then update fyp_ops_v1.email_tests set attempted_at=now() where id=p_id;claimed:=true;end if;
 return jsonb_build_object('id',d.id,'status',d.status,'claimed',claimed);
end $$;
create or replace function public.fyp_email_test_finish(p_id uuid,p_actor uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$begin
 if p_status not in ('sent','failed') then raise exception 'Invalid status' using errcode='22023';end if;
 update fyp_ops_v1.email_tests set status=p_status,finished_at=now() where id=p_id and actor=p_actor and status='reserved' and attempted_at is not null;
 if not found then raise exception 'Delivery unavailable' using errcode='42501';end if;
end $$;
revoke all on function public.fyp_reminder_smtp_claim(uuid,uuid),public.fyp_email_test_prepare(uuid,uuid),public.fyp_email_test_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fyp_reminder_smtp_claim(uuid,uuid),public.fyp_email_test_prepare(uuid,uuid),public.fyp_email_test_finish(uuid,uuid,text) to service_role;
commit;

-- Additive guardrails. Apply only to the owned FYP Compass deployment.
begin;
create schema fyp_ops_v1;
revoke all on schema fyp_ops_v1 from public,anon,authenticated;
create table fyp_ops_v1.settings(id boolean primary key default true check(id),institution_name text not null default 'FYP Compass',support_email text not null default '',timezone text not null default 'Asia/Karachi',per_user_quarter_hour integer not null default 5 check(per_user_quarter_hour between 1 and 10),per_user_day integer not null default 20 check(per_user_day between 1 and 50),global_day integer not null default 100 check(global_day between 1 and 500));
insert into fyp_ops_v1.settings(id) values(true);
create table fyp_ops_v1.ai_runs(id uuid primary key default gen_random_uuid(),actor uuid not null references public.fyp_profiles(id),project_id text not null,created_at timestamptz not null default now(),status text not null default 'reserved' check(status in ('reserved','gemini','fallback','failed')),duration_ms integer check(duration_ms between 0 and 120000),provider_status text check(length(provider_status)<=80));
create index ai_actor_time on fyp_ops_v1.ai_runs(actor,created_at desc);
create index ai_time on fyp_ops_v1.ai_runs(created_at desc);
create table fyp_ops_v1.documents(path text primary key,size bigint not null check(size between 1 and 10485760),sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),mime text not null,method text not null check(method in ('screen_v1','legacy_existing')),checked_at timestamptz not null default now());
alter table fyp_ops_v1.settings enable row level security;alter table fyp_ops_v1.ai_runs enable row level security;alter table fyp_ops_v1.documents enable row level security;
revoke all on all tables in schema fyp_ops_v1 from public,anon,authenticated;
-- Only already attached immutable objects are grandfathered; arbitrary prior uploads are not.
insert into fyp_ops_v1.documents(path,size,mime,method)
select distinct d->>'path',(d->>'size')::bigint,coalesce(o.metadata->>'mimetype','legacy'),'legacy_existing'
from (select document d from fyp_core_v2.proposals where document is not null union all select document from fyp_core_v2.submissions) x
join storage.objects o on o.bucket_id='fyp-v2-submissions' and o.name=d->>'path' and (o.metadata->>'size')::bigint=(d->>'size')::bigint on conflict do nothing;

create function public.fyp_ops_reserve_ai(p_project_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg fyp_ops_v1.settings;uid uuid:=auth.uid();v_id uuid;n integer;earliest timestamptz;wait integer;
begin
 perform fyp_health_v2.project(p_project_id,true);
 perform pg_advisory_xact_lock(hashtextextended('fyp-ops-ai-budget',0));
 if exists(select 1 from fyp_health_v2.reports where project_id=p_project_id and status='draft') then return jsonb_build_object('allowed',false,'reason','active_draft','retry_after',0);end if;
 if exists(select 1 from fyp_ops_v1.ai_runs where project_id=p_project_id and status='reserved' and created_at>now()-interval '2 minutes') then return jsonb_build_object('allowed',false,'reason','in_progress','retry_after',120);end if;
 select * into cfg from fyp_ops_v1.settings where id;
 select count(*),min(created_at) into n,earliest from fyp_ops_v1.ai_runs where actor=uid and created_at>now()-interval '15 minutes';
 if n>=cfg.per_user_quarter_hour then wait:=greatest(1,ceil(extract(epoch from earliest+interval '15 minutes'-now()))::int);return jsonb_build_object('allowed',false,'reason','rate_limit','retry_after',wait);end if;
 select count(*),min(created_at) into n,earliest from fyp_ops_v1.ai_runs where actor=uid and created_at>now()-interval '24 hours';
 if n>=cfg.per_user_day then wait:=greatest(1,ceil(extract(epoch from earliest+interval '24 hours'-now()))::int);return jsonb_build_object('allowed',false,'reason','rate_limit','retry_after',wait);end if;
 select count(*),min(created_at) into n,earliest from fyp_ops_v1.ai_runs where created_at>now()-interval '24 hours';
 if n>=cfg.global_day then wait:=greatest(1,ceil(extract(epoch from earliest+interval '24 hours'-now()))::int);return jsonb_build_object('allowed',false,'reason','daily_budget','retry_after',wait);end if;
 insert into fyp_ops_v1.ai_runs(actor,project_id) values(uid,p_project_id) returning id into v_id;
 return jsonb_build_object('allowed',true,'id',v_id);
end $$;
revoke all on function public.fyp_ops_reserve_ai(text) from public,anon;grant execute on function public.fyp_ops_reserve_ai(text) to authenticated;

create function public.fyp_ops_finish_ai(p_id uuid,p_actor uuid,p_status text,p_duration_ms integer,p_provider_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('gemini','fallback','failed') or p_status is null or p_duration_ms not between 0 and 120000 or p_duration_ms is null or p_provider_status !~ '^[a-z0-9_ -]{1,80}$' or p_provider_status is null then raise exception 'Invalid operational status';end if;
 update fyp_ops_v1.ai_runs set status=p_status,duration_ms=p_duration_ms,provider_status=p_provider_status where id=p_id and actor=p_actor and status='reserved';
 if not found then raise exception 'Reservation unavailable';end if;
end $$;
revoke all on function public.fyp_ops_finish_ai(uuid,uuid,text,integer,text) from public,anon,authenticated;grant execute on function public.fyp_ops_finish_ai(uuid,uuid,text,integer,text) to service_role;

create function public.fyp_ops_record_document(p_actor uuid,p_path text,p_size bigint,p_sha256 text,p_mime text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.fyp_profiles where id=p_actor and role::text='student') or split_part(p_path,'/',1)<>p_actor::text or not exists(select 1 from fyp_core_v2.members where student_id=p_actor and group_id::text=split_part(p_path,'/',2)) then raise exception 'Document owner unavailable';end if;
 if p_sha256 !~ '^[a-f0-9]{64}$' or p_sha256 is null or p_size not between 1 and 10485760 or p_size is null or not ((p_path ~ '\.pdf$' and p_mime='application/pdf') or (p_path ~ '\.docx$' and p_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document')) then raise exception 'Invalid verified file';end if;
 if not exists(select 1 from storage.objects where bucket_id='fyp-v2-submissions' and name=p_path and (metadata->>'size')::bigint=p_size) then raise exception 'Stored bytes differ';end if;
 insert into fyp_ops_v1.documents(path,size,sha256,mime,method) values(p_path,p_size,p_sha256,p_mime,'screen_v1') on conflict(path) do update set sha256=excluded.sha256,mime=excluded.mime,method=excluded.method,checked_at=now() where fyp_ops_v1.documents.size=excluded.size;
end $$;
revoke all on function public.fyp_ops_record_document(uuid,text,bigint,text,text) from public,anon,authenticated;grant execute on function public.fyp_ops_record_document(uuid,text,bigint,text,text) to service_role;

create or replace function fyp_core_v2.document(g uuid,d jsonb) returns void language plpgsql security definer set search_path='' as $$begin
if d is null then return;end if;
if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'size') is distinct from 'number' or (d->>'size')::numeric not between 1 and 10485760 or d->>'name' is null or length(d->>'name') not between 1 and 255 or d->>'path' is null or split_part(d->>'path','/',1)<>auth.uid()::text or split_part(d->>'path','/',2)<>g::text or d->>'path' !~ '\.(pdf|doc|docx)$' then raise exception 'Invalid private document';end if;
if not exists(select 1 from storage.objects where bucket_id='fyp-v2-submissions' and name=d->>'path' and (metadata->>'size')::numeric=(d->>'size')::numeric) then raise exception 'Uploaded document is missing or size differs';end if;
if not exists(select 1 from fyp_ops_v1.documents where path=d->>'path' and size=(d->>'size')::bigint) then raise exception 'Document content verification is required before attachment' using errcode='22023';end if;
end $$;

create function public.fyp_ops_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg fyp_ops_v1.settings;begin
 perform fyp_core_v2.role('coordinator');select * into cfg from fyp_ops_v1.settings where id;
 return jsonb_build_object('checked_at',now(),'institution',jsonb_build_object('name',cfg.institution_name,'support_email',cfg.support_email,'timezone',cfg.timezone),'limits',jsonb_build_object('per_15_minutes',cfg.per_user_quarter_hour,'per_user_day',cfg.per_user_day,'daily_total',cfg.global_day),'ai',(select jsonb_build_object('total',count(*),'gemini',count(*) filter(where status='gemini'),'fallback',count(*) filter(where status='fallback'),'failed',count(*) filter(where status='failed'),'in_progress',count(*) filter(where status='reserved' and created_at>now()-interval '2 minutes'),'interrupted',count(*) filter(where status='reserved' and created_at<=now()-interval '2 minutes'),'average_ms',coalesce(round(avg(duration_ms)),0)) from fyp_ops_v1.ai_runs where created_at>now()-interval '24 hours'),'documents',(select jsonb_build_object('screened',count(*) filter(where method='screen_v1'),'existing',count(*) filter(where method='legacy_existing')) from fyp_ops_v1.documents),'accounts',(select jsonb_build_object('total',count(*),'demo',count(*) filter(where full_name like 'Demo %' or full_name like 'Student %' or full_name like 'Examiner %')) from public.fyp_profiles),'active_session',(select name from fyp_core_v2.sessions where active),'reminders',(select max(ran_at) from fyp_engagement_v1.reminder_runs));
end $$;
revoke all on function public.fyp_ops_status() from public,anon;grant execute on function public.fyp_ops_status() to authenticated;
create function public.fyp_ops_update_institution(p_name text,p_email text,p_timezone text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fyp_core_v2.role('coordinator');
 if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_email is null or length(p_email)>254 or (p_email<>'' and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid institution settings';end if;
 update fyp_ops_v1.settings set institution_name=btrim(p_name),support_email=btrim(p_email),timezone=p_timezone where id;
 insert into fyp_core_v2.audit(actor,action,record_id,details) values(auth.uid(),'institution_updated','production',jsonb_build_object('name',btrim(p_name),'support_email',btrim(p_email),'timezone',p_timezone));
 return public.fyp_ops_status();end $$;
revoke all on function public.fyp_ops_update_institution(text,text,text) from public,anon;grant execute on function public.fyp_ops_update_institution(text,text,text) to authenticated;
revoke all on all functions in schema fyp_ops_v1 from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

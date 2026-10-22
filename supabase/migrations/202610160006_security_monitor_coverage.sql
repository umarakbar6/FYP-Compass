-- Exclude blocked demo identities from actionable MFA alerts; cover both AI engines.
begin;
create or replace function fyp_security_v1.collect_alerts()returns void
language plpgsql volatile security definer set search_path=''as $$
declare n integer;begin
 perform pg_advisory_xact_lock(hashtextextended('fyp-security-alerts',0));
 insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)
 select 'sessions:'||actor::text||':'||date_trunc('hour',created_at)::text,'session_burst','warning',count(*)::integer
 from fyp_security_v1.events where kind='session_observed'and created_at>now()-interval '24 hours'group by actor,date_trunc('hour',created_at)having count(*)>=20
 on conflict(dedupe_key)do update set total=excluded.total;
 select count(*)::integer into n from public.fyp_profiles p where p.role::text<>'student'and not fyp_security_v1.has_factor(p.id)and((select demo_access_enabled from fyp_security_v1.settings where singleton)or not fyp_security_v1.is_demo(p.id));
 if n>0 then
  insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)values('staff-mfa:'||current_date,'staff_mfa_gap','warning',n)
  on conflict(dedupe_key)do update set total=excluded.total;
 else update fyp_security_v1.alerts set reviewed_at=coalesce(reviewed_at,now())where kind='staff_mfa_gap';end if;
 if(select demo_access_enabled from fyp_security_v1.settings where singleton)then
  insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)values('demo:'||current_date,'demo_access','warning',1)on conflict(dedupe_key)do nothing;
 else update fyp_security_v1.alerts set reviewed_at=coalesce(reviewed_at,now())where kind='demo_access';end if;
 if to_regclass('fyp_ops_v1.ai_runs')is not null then
  select count(*)::integer into n from fyp_ops_v1.ai_runs where status='failed'and created_at>now()-interval '1 hour';
  if to_regclass('fyp_agents_v1.runs')is not null then n:=n+(select count(*)::integer from fyp_agents_v1.runs where status='failed'and created_at>now()-interval '1 hour');end if;
  if n>=3 then insert into fyp_security_v1.alerts(dedupe_key,kind,severity,total)values('ai:'||date_trunc('hour',now()),'ai_failures','critical',n)
   on conflict(dedupe_key)do update set total=excluded.total;end if;
 end if;
 -- Retention applies only to these newly introduced operational records.
 delete from fyp_security_v1.events where created_at<now()-interval '90 days';
 delete from fyp_security_v1.alerts where reviewed_at<now()-interval '30 days';
end$$;

create or replace function public.fyp_security_dashboard()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 perform fyp_core_v2.role('coordinator');perform fyp_security_v1.collect_alerts();
 return public.fyp_security_context()||jsonb_build_object('checked_at',now(),
  'observed_sessions_24h',(select count(*)from fyp_security_v1.events where kind='session_observed'and created_at>now()-interval '24 hours'),
  'alerts',(select coalesce(jsonb_agg(to_jsonb(a)order by a.created_at desc),'[]')from(select id,kind,severity,total,created_at,reviewed_at from fyp_security_v1.alerts order by created_at desc limit 100)a),
  'staff',(select coalesce(jsonb_agg(to_jsonb(s)order by s.role,s.full_name),'[]')from(
   select p.id,p.full_name,p.role,fyp_security_v1.has_factor(p.id)as mfa_enabled,
    p.id=(select owner_id from fyp_accounts_v1.settings where singleton)as is_owner,
    (not(select demo_access_enabled from fyp_security_v1.settings where singleton)and fyp_security_v1.is_demo(p.id))as demo_blocked
   from public.fyp_profiles p where p.role::text<>'student')s));
end$$;

notify pgrst,'reload schema';
commit;

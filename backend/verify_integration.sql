-- FYP Compass full-stack integration verification
-- Safe read-only checks.

select table_name
from information_schema.tables
where table_schema='public' and table_name like 'fyp_%'
order by table_name;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'fyp_%'
order by c.relname;

select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'get_student_workspace',
    'create_student_group',
    'save_student_proposal',
    'get_supervisor_workspace',
    'review_supervisor_proposal',
    'get_milestone_workspace',
    'submit_student_milestone',
    'save_milestone_contribution',
    'review_supervisor_milestone',
    'fyp_role_module_data',
    'fyp_submit_health_report',
    'fyp_mark_notice_read',
    'fyp_get_my_health',
    'fyp_compute_group_health',
    'fyp_latest_group_health',
    'fyp_run_health_agent',
    'fyp_notice_action',
    'fyp_auto_allocate',
    'fyp_coordinator_dashboard',
    'fyp_accreditation_report'
  )
order by routine_name;

-- Explicit presence check for BOTH legacy health RPCs and the latest member-1 contract.
with expected(routine_name) as (
  values
    ('fyp_get_my_health'),
    ('fyp_compute_group_health'),
    ('fyp_latest_group_health'),
    ('fyp_submit_health_report'),
    ('fyp_run_health_agent'),
    ('fyp_notice_action'),
    ('fyp_mark_notice_read'),
    ('get_health_workspace'),
    ('calculate_group_health'),
    ('prepare_group_health_draft'),
    ('save_group_health_draft'),
    ('review_group_health'),
    ('mark_health_notice_read')
)
select e.routine_name,
       exists (
         select 1
         from information_schema.routines r
         where r.routine_schema = 'public'
           and r.routine_name = e.routine_name
       ) as present
from expected e
order by e.routine_name;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id='fyp-submissions';

select count(*) as auth_users from auth.users;
select role, count(*) from public.fyp_profiles group by role order by role;


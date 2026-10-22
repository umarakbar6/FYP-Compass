-- Public email registration grants only the student role after verified email ownership.
begin;
create schema if not exists fyp_registration_v1;
revoke all on schema fyp_registration_v1 from public,anon,authenticated;
-- The existing active session now accepts real students; keep its id and academic records.
update fyp_core_v2.sessions set name='FYP Compass Academic Session 2026'
where active and name='FYP Compass Hackathon Demo 2026';

create or replace function fyp_registration_v1.enroll_verified_student(p_actor uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid;begin
 if not exists(select 1 from auth.users u join public.fyp_profiles p on p.id=u.id
   where u.id=p_actor and u.email_confirmed_at is not null and p.role::text='student')
 then raise exception 'A verified student email is required' using errcode='42501';end if;
 select id into sid from fyp_core_v2.sessions where active;
 if sid is not null then
  insert into fyp_core_v2.participants(profile_id,session_id)values(p_actor,sid)on conflict do nothing;
 end if;
 return sid;
end$$;

create or replace function fyp_registration_v1.handle_verified_signup()
returns trigger language plpgsql security definer set search_path='' as $$
declare student_name text;begin
 -- Metadata describes display identity only. Never trust a requested role.
 if new.email_confirmed_at is null or new.raw_user_meta_data->>'registration_source' is distinct from 'student_self_service_v1'
   or new.email is null or length(btrim(new.email))=0 then return new;end if;
 student_name:=left(btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name',''),'[[:cntrl:]]','','g')),120);
 if length(student_name)<2 then student_name:='Student';end if;
 insert into public.fyp_profiles(id,full_name,role)values(new.id,student_name,'student')on conflict(id)do nothing;
 if exists(select 1 from public.fyp_profiles where id=new.id and role::text='student')then
  perform fyp_registration_v1.enroll_verified_student(new.id);
 end if;
 return new;
end$$;
drop trigger if exists fyp_student_verified_signup on auth.users;
create trigger fyp_student_verified_signup after insert or update of email_confirmed_at on auth.users
for each row execute function fyp_registration_v1.handle_verified_signup();

-- Keep the original workspace implementation intact and wrap it with own-account enrollment.
do $$begin
 if to_regprocedure('fyp_registration_v1.student_workspace_base()')is null then
  alter function public.fyp_v2_core_get_student_workspace() rename to student_workspace_base;
  alter function public.student_workspace_base() set schema fyp_registration_v1;
 end if;
end$$;
create or replace function public.fyp_v2_core_get_student_workspace()returns jsonb
language plpgsql security definer set search_path=''as $$begin
 perform fyp_core_v2.role('student');
 perform fyp_registration_v1.enroll_verified_student(auth.uid());
 return fyp_registration_v1.student_workspace_base();
end$$;
revoke all on all functions in schema fyp_registration_v1 from public,anon,authenticated;
revoke all on function public.fyp_v2_core_get_student_workspace()from public,anon;
grant execute on function public.fyp_v2_core_get_student_workspace()to authenticated;
-- Keep the support assistant's published knowledge aligned with real student onboarding.
do $$declare definition text;old_copy text:='Accounts are invited by the coordinator; recovery is available through Forgot your password and requires configured email delivery.';
new_copy text:='Students register with their own email at /register and verify it. Staff accounts are invited by the coordinator. Password recovery is available through Forgot your password.';
begin
 if to_regprocedure('public.fyp_agents_context(text,uuid)')is not null then
  select pg_get_functiondef('public.fyp_agents_context(text,uuid)'::regprocedure)into definition;
  if strpos(definition,old_copy)>0 then execute replace(definition,old_copy,new_copy);
  elsif strpos(definition,new_copy)=0 then raise exception 'Support knowledge changed; inspect before applying the registration update';end if;
 end if;
end$$;
notify pgrst,'reload schema';
commit;

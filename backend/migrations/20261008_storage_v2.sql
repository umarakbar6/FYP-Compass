-- Dedicated private bucket. No existing bucket or original file is changed.
begin;
do $$begin if exists(select 1 from storage.buckets where id='fyp-v2-submissions') then raise exception 'V2 bucket already exists; inspect policies instead of reapplying';end if;end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fyp-v2-submissions','fyp-v2-submissions',false,10485760,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create function public.fyp_v2_core_file_access(p_name text,p_write boolean) returns boolean language plpgsql stable security definer set search_path='' as $$declare g uuid;r text;permitted boolean;begin
if auth.uid() is null or p_name is null then return false;end if;r:=fyp_core_v2.role();begin g:=split_part(p_name,'/',2)::uuid;exception when others then return false;end;
if p_write then return r='student' and split_part(p_name,'/',1)=auth.uid()::text and exists(select 1 from fyp_core_v2.members where group_id=g and student_id=auth.uid()) and (not exists(select 1 from fyp_core_v2.proposals where group_id=g) or (fyp_core_v2.proposal(g)).status in ('draft','changes_requested','rejected','withdrawn') or exists(select 1 from fyp_core_v2.milestones where group_id=g and status in ('not_started','needs_rework')));
end if;
if r='student' then return exists(select 1 from fyp_core_v2.members where group_id=g and student_id=auth.uid());elsif r='supervisor' then return exists(select 1 from fyp_core_v2.allocations where group_id=g and supervisor_id=auth.uid());elsif r='examiner' then select exists(select 1 from fyp_assessment_v2.defenses where project_id=g::text and auth.uid() in (examiner_one,examiner_two)) into permitted;return permitted;end if;return false;
end $$;
revoke all on function public.fyp_v2_core_file_access(text,boolean) from public;grant execute on function public.fyp_v2_core_file_access(text,boolean) to anon,authenticated;
create policy fyp_v2_private_read on storage.objects for select to authenticated using(bucket_id='fyp-v2-submissions' and public.fyp_v2_core_file_access(name,false));
create policy fyp_v2_immutable_upload on storage.objects for insert to authenticated with check(bucket_id='fyp-v2-submissions' and public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760));
-- Restrictive guards also constrain any broad legacy permissive policies.
create policy fyp_v2_guard_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'fyp-v2-submissions' or public.fyp_v2_core_file_access(name,false));
create policy fyp_v2_guard_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'fyp-v2-submissions' or (public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760)));
create policy fyp_v2_guard_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'fyp-v2-submissions') with check(bucket_id<>'fyp-v2-submissions');
create policy fyp_v2_guard_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'fyp-v2-submissions');
commit;

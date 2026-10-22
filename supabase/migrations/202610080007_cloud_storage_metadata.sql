-- Storage inserts may initially have null metadata. Bucket enforces MIME/10 MiB; document RPC verifies final stored size.
begin;
drop policy fyp_v2_immutable_upload on storage.objects;
drop policy fyp_v2_guard_insert on storage.objects;
create policy fyp_v2_immutable_upload on storage.objects for insert to authenticated with check(bucket_id='fyp-v2-submissions' and public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760));
create policy fyp_v2_guard_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'fyp-v2-submissions' or (public.fyp_v2_core_file_access(name,true) and name ~ '\.(pdf|doc|docx)$' and (metadata is null or metadata->>'size' is null or (metadata->>'size')::numeric between 1 and 10485760)));
commit;

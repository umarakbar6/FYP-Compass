-- Bound storage-fill abuse at the database policy, including direct Storage API calls.
begin;
create or replace function public.fyp_upload_budget(p_name text,p_metadata jsonb)returns boolean
language plpgsql volatile security definer set search_path=''as $$
declare actor text;group_key text;new_bytes bigint;user_bytes bigint;group_bytes bigint;recent_count integer;
begin
 actor:=auth.uid()::text;
 if actor is null or p_name is null or not public.fyp_v2_core_file_access(p_name,true)then return false;end if;
 group_key:=split_part(p_name,'/',2);
 if p_metadata is not null and jsonb_typeof(p_metadata)<>'object'then return false;end if;
 begin new_bytes:=coalesce((p_metadata->>'size')::bigint,10485760);
 exception when invalid_text_representation or numeric_value_out_of_range then return false;end;
 if new_bytes not between 1 and 10485760 then return false;end if;
 -- Consistent locking prevents simultaneous inserts from bypassing either byte budget.
 perform pg_advisory_xact_lock(hashtextextended('upload-user:'||actor,0));
 perform pg_advisory_xact_lock(hashtextextended('upload-group:'||group_key,0));
 select coalesce(sum(coalesce((metadata->>'size')::bigint,10485760)),0),
  count(*)filter(where created_at>now()-interval'24 hours')
 into user_bytes,recent_count from storage.objects
 where bucket_id='fyp-v2-submissions'and split_part(name,'/',1)=actor;
 select coalesce(sum(coalesce((metadata->>'size')::bigint,10485760)),0)into group_bytes
 from storage.objects where bucket_id='fyp-v2-submissions'and split_part(name,'/',2)=group_key;
 return recent_count<20 and user_bytes+new_bytes<=104857600 and group_bytes+new_bytes<=209715200;
end$$;
revoke all on function public.fyp_upload_budget(text,jsonb)from public;
grant execute on function public.fyp_upload_budget(text,jsonb)to anon,authenticated;
create policy fyp_upload_budget_guard on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'fyp-v2-submissions'or public.fyp_upload_budget(name,metadata));
notify pgrst,'reload schema';
commit;

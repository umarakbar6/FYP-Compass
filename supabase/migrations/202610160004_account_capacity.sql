-- Total registered identities, including unconfirmed email reservations.
-- Owner exemption is pinned by a database administrator, never user metadata.
begin;
create schema if not exists fyp_accounts_v1;
revoke all on schema fyp_accounts_v1 from public,anon,authenticated,service_role;
create table fyp_accounts_v1.settings(singleton boolean primary key default true check(singleton),owner_id uuid unique references auth.users(id),owner_email text);
insert into fyp_accounts_v1.settings(singleton)values(true);
create table fyp_accounts_v1.limits(role text primary key,maximum integer not null check(maximum>0));
insert into fyp_accounts_v1.limits values('student',100),('supervisor',10),('coordinator',2);
create table fyp_accounts_v1.slots(account_id uuid primary key references auth.users(id) on delete cascade,role text not null check(role in ('student','supervisor','examiner','coordinator')));
alter table fyp_accounts_v1.settings enable row level security;
alter table fyp_accounts_v1.limits enable row level security;
alter table fyp_accounts_v1.slots enable row level security;
revoke all on all tables in schema fyp_accounts_v1 from public,anon,authenticated,service_role;

insert into fyp_accounts_v1.slots(account_id,role)
select u.id,coalesce(p.role::text,(select i.role from fyp_ops_v1.invites i where lower(i.email)=lower(u.email) and i.status in ('pending','profile_pending') order by i.created_at desc,i.id limit 1),'student')
from auth.users u left join public.fyp_profiles p on p.id=u.id;

create function fyp_accounts_v1.capacity()
returns table(role text,maximum integer,registered bigint,reserved bigint)
language sql security definer set search_path=''as $$
 select l.role,l.maximum,
 (select count(*)from fyp_accounts_v1.slots s where s.role=l.role and s.account_id is distinct from (select owner_id from fyp_accounts_v1.settings where singleton)),
 (select count(distinct lower(i.email))from fyp_ops_v1.invites i where i.role=l.role and i.status in ('pending','profile_pending') and not exists(select 1 from auth.users u where lower(u.email)=lower(i.email)))
 from fyp_accounts_v1.limits l order by l.role
$$;
create function fyp_accounts_v1.assert_capacity()returns void
language plpgsql security definer set search_path=''as $$
declare c record;begin
 for c in select * from fyp_accounts_v1.capacity()loop
  if c.registered+c.reserved>c.maximum then
   raise exception 'The % account capacity has been reached. Contact the portal owner.',c.role using errcode='P0001';
  end if;
 end loop;
end$$;

create function fyp_accounts_v1.set_owner(p_id uuid,p_email text)returns void
language plpgsql security definer set search_path=''as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('fyp-account-capacity',0));
 if not exists(select 1 from auth.users u join public.fyp_profiles p on p.id=u.id where u.id=p_id and lower(u.email)=lower(btrim(p_email)) and u.email_confirmed_at is not null and p.role::text='coordinator')then
  raise exception 'The verified existing coordinator identity is required' using errcode='22023';
 end if;
 if exists(select 1 from fyp_accounts_v1.settings where owner_id is not null and owner_id<>p_id)then
  raise exception 'Owner is already pinned; use a separately reviewed ownership migration' using errcode='42501';
 end if;
 update fyp_accounts_v1.settings set owner_id=p_id,owner_email=lower(btrim(p_email))where singleton;
 perform fyp_accounts_v1.assert_capacity();
end$$;

create function fyp_accounts_v1.guard_identity()returns trigger
language plpgsql security definer set search_path=''as $$
declare assigned text;owner_record fyp_accounts_v1.settings;begin
 select * into owner_record from fyp_accounts_v1.settings where singleton;
 if tg_op='UPDATE' then
  if (new.id=owner_record.owner_id and lower(coalesce(new.email,'')) is distinct from owner_record.owner_email)
   or (new.id is distinct from owner_record.owner_id and lower(new.email)=owner_record.owner_email)then
   raise exception 'The portal owner email is protected' using errcode='42501';
  end if;
  return new;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('fyp-account-capacity',0));
 select i.role into assigned from fyp_ops_v1.invites i where lower(i.email)=lower(new.email)and i.status in ('pending','profile_pending')order by i.created_at desc,i.id limit 1;
 insert into fyp_accounts_v1.slots(account_id,role)values(new.id,coalesce(assigned,'student'));
 perform fyp_accounts_v1.assert_capacity();
 return new;
end$$;
create trigger fyp_identity_capacity after insert on auth.users for each row execute function fyp_accounts_v1.guard_identity();
create trigger fyp_owner_email_guard before update of email on auth.users for each row execute function fyp_accounts_v1.guard_identity();

create function fyp_accounts_v1.guard_profile()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('fyp-account-capacity',0));
 if tg_op='UPDATE'and new.id<>old.id then raise exception 'Profile identity is immutable' using errcode='42501';end if;
 if new.id=(select owner_id from fyp_accounts_v1.settings where singleton)and new.role::text<>'coordinator'then
  raise exception 'The portal owner role is protected'using errcode='42501';
 end if;
 insert into fyp_accounts_v1.slots(account_id,role)values(new.id,new.role::text)on conflict(account_id)do update set role=excluded.role;
 perform fyp_accounts_v1.assert_capacity();return new;
end$$;
create trigger fyp_profile_capacity before insert or update of id,role on public.fyp_profiles for each row execute function fyp_accounts_v1.guard_profile();

-- Check the entire batch before the Edge Function sends any invitations.
alter function public.fyp_admin_invite_reserve(uuid,uuid,jsonb)rename to reserve_invites_base;
alter function public.reserve_invites_base(uuid,uuid,jsonb)set schema fyp_accounts_v1;
create function public.fyp_admin_invite_reserve(p_request_id uuid,p_session_id uuid,p_people jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare result jsonb;begin
 perform fyp_core_v2.role('coordinator');
 perform pg_advisory_xact_lock(hashtextextended('fyp-account-capacity',0));
 result:=fyp_accounts_v1.reserve_invites_base(p_request_id,p_session_id,p_people);
 if exists(select 1 from fyp_ops_v1.invites i where i.status in ('pending','profile_pending')and not exists(select 1 from auth.users u where lower(u.email)=lower(i.email))group by lower(i.email)having count(distinct i.role)>1)then
  raise exception 'An email already has a pending invitation for another role'using errcode='22023';
 end if;
 perform fyp_accounts_v1.assert_capacity();return result;
end$$;
create function public.fyp_account_capacity()returns jsonb
language plpgsql security definer set search_path=''as $$begin
 perform fyp_core_v2.role('coordinator');
 return jsonb_build_object('owner_excluded',(select owner_id is not null from fyp_accounts_v1.settings where singleton),'limits',(select jsonb_agg(to_jsonb(c))from fyp_accounts_v1.capacity()c));
end$$;
revoke all on all functions in schema fyp_accounts_v1 from public,anon,authenticated,service_role;
revoke all on function public.fyp_admin_invite_reserve(uuid,uuid,jsonb),public.fyp_account_capacity()from public,anon,authenticated;
grant execute on function public.fyp_admin_invite_reserve(uuid,uuid,jsonb),public.fyp_account_capacity()to authenticated;
notify pgrst,'reload schema';
commit;

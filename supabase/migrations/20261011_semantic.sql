begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create table if not exists fyp_agents_v1.proposal_embeddings(
 proposal_id uuid primary key references fyp_core_v2.proposals(id) on delete cascade,
 embedding extensions.vector(768) not null,source_version text not null,
 model text not null default 'gemini-embedding-001',updated_at timestamptz not null default now());
alter table fyp_agents_v1.proposal_embeddings enable row level security;
revoke all on fyp_agents_v1.proposal_embeddings from public,anon,authenticated;
create or replace function public.fyp_agents_cache_embedding(p_actor uuid,p_proposal_id uuid,p_embedding text,p_source_version text)
returns void language plpgsql security definer set search_path='' as $$
declare pr fyp_core_v2.proposals;role_name text;vec extensions.vector;begin
 select role into role_name from public.fyp_profiles where id=p_actor;
 select * into pr from fyp_core_v2.proposals where id=p_proposal_id;
 if pr.id is null or not ((role_name='student' and exists(select 1 from fyp_core_v2.members where group_id=pr.group_id and student_id=p_actor))
 or (role_name='supervisor' and exists(select 1 from fyp_core_v2.allocations where group_id=pr.group_id and supervisor_id=p_actor))) then raise exception 'Proposal access denied' using errcode='42501';end if;
 if p_source_version is distinct from md5(pr.title||chr(10)||pr.abstract)then raise exception 'Proposal evidence changed'using errcode='40001';end if;
 if p_embedding is null or length(p_embedding)>30000 then raise exception 'Embedding missing or too large' using errcode='22023';end if;
 if jsonb_typeof(p_embedding::jsonb) is distinct from 'array' then raise exception 'Embedding must be a numeric array' using errcode='22023';end if;
 if jsonb_array_length(p_embedding::jsonb)<>768 or exists(select 1 from jsonb_array_elements(p_embedding::jsonb)x where jsonb_typeof(x)<>'number')then raise exception 'Invalid embedding dimensions or values'using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements_text(p_embedding::jsonb)x where abs(x::numeric)>100)or not exists(select 1 from jsonb_array_elements_text(p_embedding::jsonb)x where x::numeric<>0)then raise exception 'Invalid embedding magnitude'using errcode='22023';end if;
 vec:=p_embedding::extensions.vector;
 if extensions.vector_dims(vec)<>768 then raise exception 'Invalid embedding dimensions' using errcode='22023';end if;
 insert into fyp_agents_v1.proposal_embeddings(proposal_id,embedding,source_version) values(pr.id,vec,md5(pr.title||chr(10)||pr.abstract))
 on conflict(proposal_id) do update set embedding=excluded.embedding,source_version=excluded.source_version,updated_at=now();
end $$;
create or replace function public.fyp_agents_semantic_matches(p_project_id uuid,p_embedding text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;g fyp_core_v2.groups;vec extensions.vector;begin
 r:=fyp_core_v2.role();perform fyp_core_v2.authorize(p_project_id);
 if p_embedding is null or length(p_embedding)>30000 then raise exception 'Embedding missing or too large' using errcode='22023';end if;
 if jsonb_typeof(p_embedding::jsonb) is distinct from 'array' then raise exception 'Embedding must be a numeric array' using errcode='22023';end if;
 if jsonb_array_length(p_embedding::jsonb)<>768 or exists(select 1 from jsonb_array_elements(p_embedding::jsonb)x where jsonb_typeof(x)<>'number')then raise exception 'Invalid embedding dimensions or values'using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements_text(p_embedding::jsonb)x where abs(x::numeric)>100)or not exists(select 1 from jsonb_array_elements_text(p_embedding::jsonb)x where x::numeric<>0)then raise exception 'Invalid embedding magnitude'using errcode='22023';end if;
 vec:=p_embedding::extensions.vector;
 if extensions.vector_dims(vec)<>768 then raise exception 'Invalid embedding dimensions' using errcode='22023';end if;
 select * into g from fyp_core_v2.groups where id=p_project_id;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select pr.id,1-(e.embedding operator(extensions.<=>) vec) as similarity
 from fyp_agents_v1.proposal_embeddings e join fyp_core_v2.proposals pr on pr.id=e.proposal_id join fyp_core_v2.groups gr on gr.id=pr.group_id
 where r='supervisor' and gr.session_id=g.session_id and gr.id<>g.id and pr.status<>'draft' and e.source_version=md5(pr.title||chr(10)||pr.abstract)
 and exists(select 1 from fyp_core_v2.allocations a where a.group_id=gr.id and a.supervisor_id=auth.uid())
 order by e.embedding operator(extensions.<=>) vec limit 5)x);
end $$;
revoke all on function public.fyp_agents_cache_embedding(uuid,uuid,text,text),public.fyp_agents_semantic_matches(uuid,text) from public,anon,authenticated;
grant execute on function public.fyp_agents_cache_embedding(uuid,uuid,text,text) to service_role;
grant execute on function public.fyp_agents_semantic_matches(uuid,text) to authenticated;
commit;

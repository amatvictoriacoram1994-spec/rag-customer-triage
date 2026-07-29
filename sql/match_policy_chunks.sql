create or replace function public.match_policy_chunks(
  query_embedding extensions.vector(1024),
  match_count integer default 5
)
returns table (
  id bigint, chunk_key text, document_id text, document_title text,
  document_version text, effective_date date, section_number integer,
  section_title text, content text, metadata jsonb, similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pc.id, pc.chunk_key, pc.document_id, pc.document_title,
    pc.document_version, pc.effective_date, pc.section_number,
    pc.section_title, pc.content, pc.metadata,
    1 - (pc.embedding <=> query_embedding) as similarity
  from public.policy_chunks as pc
  order by pc.embedding <=> query_embedding
  limit greatest(match_count, 0);
$$;

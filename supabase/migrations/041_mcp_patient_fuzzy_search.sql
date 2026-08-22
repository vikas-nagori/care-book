-- Fuzzy patient lookup for MCP, plus housekeeping for expired MCP artifacts.
--
-- Why: the MCP patient tools matched names with a bare `ilike '%term%'`, so a typo or a
-- shortened name ("Adi" for "Aadi") found nothing at all, while a term that happened to be an
-- exact match for one record silently hid every other record that also matched. Trigram
-- similarity gives the caller the full candidate set with a rank, so the tool layer can insist
-- on confirmation whenever more than one patient could plausibly be meant.

create extension if not exists pg_trgm;

create index if not exists idx_patients_name_trgm
  on public.patients using gin (name gin_trgm_ops);

-- SECURITY INVOKER (the default) is deliberate: patient rows stay behind the caller's own RLS
-- policies, so this is a ranking helper, never a way around tenancy.
create or replace function public.search_patients_fuzzy(
  search_term text,
  match_limit integer default 20
)
returns table (
  id uuid,
  name text,
  phone text,
  dob date,
  match_score real
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    patient.id,
    patient.name,
    patient.phone,
    patient.dob,
    -- An exact (case-insensitive) name always outranks a merely similar one, and a containment
    -- match outranks a pure trigram hit, so the tool layer can tell "certain" from "probable".
    (case
      when lower(btrim(patient.name)) = lower(btrim(search_term)) then 1.0
      when patient.name ilike '%' || search_term || '%' then 0.9
      else similarity(patient.name, search_term)
    end)::real as match_score
  from public.patients patient
  where search_term is not null
    and btrim(search_term) <> ''
    and (
      patient.name ilike '%' || search_term || '%'
      or similarity(patient.name, search_term) > 0.3
    )
  order by match_score desc, patient.name
  limit least(greatest(coalesce(match_limit, 20), 1), 50);
$$;

revoke all on function public.search_patients_fuzzy(text, integer) from public;
grant execute on function public.search_patients_fuzzy(text, integer) to authenticated, service_role;

-- Housekeeping. An abandoned consent leaves an authorization code row holding an encrypted
-- Supabase refresh token; nothing deleted it, because codes are only removed on redemption.
create or replace function private.purge_expired_mcp_artifacts()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer := 0;
  batch integer;
begin
  delete from public.mcp_authorization_codes where expires_at < now();
  get diagnostics batch = row_count;
  removed := removed + batch;

  delete from public.mcp_resolution_tokens
  where expires_at < now() - interval '1 day';
  get diagnostics batch = row_count;
  removed := removed + batch;

  return removed;
end;
$$;

revoke all on function private.purge_expired_mcp_artifacts() from public;
grant execute on function private.purge_expired_mcp_artifacts() to service_role;

-- Enable pg_cron (Database -> Extensions) and run this manually to schedule the purge, the same
-- way migration 001 schedules appointment auto-completion:
--
-- select cron.schedule(
--   'purge-expired-mcp-artifacts',
--   '17 * * * *',
--   $$select private.purge_expired_mcp_artifacts()$$
-- );

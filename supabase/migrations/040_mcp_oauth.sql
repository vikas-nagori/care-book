-- OAuth-protected remote MCP server state. Raw tokens are never persisted.
create table if not exists public.mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null default 'none',
  client_secret_hash text,
  created_at timestamptz not null default now(),
  constraint mcp_oauth_clients_secret_check check (
    (token_endpoint_auth_method = 'none' and client_secret_hash is null)
    or (token_endpoint_auth_method <> 'none' and client_secret_hash is not null)
  )
);

create table if not exists public.mcp_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  scopes text[] not null,
  code_challenge text not null,
  redirect_uri text not null,
  resource text not null,
  supabase_refresh_token_ciphertext text,
  supabase_refresh_token_nonce text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  scopes text[] not null,
  resource text not null,
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  supabase_refresh_token_ciphertext text,
  supabase_refresh_token_nonce text,
  supabase_refresh_token_version bigint not null default 0,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mcp_grant_refresh_cipher_check check (
    (supabase_refresh_token_ciphertext is null and supabase_refresh_token_nonce is null)
    or (supabase_refresh_token_ciphertext is not null and supabase_refresh_token_nonce is not null)
  )
);
create index if not exists idx_mcp_grants_user_active
  on public.mcp_access_grants(user_id) where revoked_at is null;

create table if not exists public.mcp_tool_invocations (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.mcp_access_grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  tool_name text not null,
  idempotency_key text,
  request_digest text not null,
  status text not null check (status in ('ok', 'error', 'denied', 'dry_run')),
  error_code text,
  result_json jsonb,
  entity_type text,
  entity_id uuid,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_mcp_invocations_idempotency
  on public.mcp_tool_invocations(grant_id, idempotency_key)
  where idempotency_key is not null and status = 'ok';

create table if not exists public.mcp_resolution_tokens (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.mcp_access_grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  token_hash text not null unique,
  entity_type text not null check (entity_type in ('patient', 'payment', 'package', 'appointment')),
  entity_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_mcp_resolution_tokens_expiry
  on public.mcp_resolution_tokens(expires_at);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_authorization_codes enable row level security;
alter table public.mcp_access_grants enable row level security;
alter table public.mcp_tool_invocations enable row level security;
alter table public.mcp_resolution_tokens enable row level security;

-- OAuth persistence is server-managed. Authenticated users can only inspect/revoke their
-- own connected grants and inspect invocations allowed by the policies below.
grant select on public.mcp_oauth_clients to authenticated;
grant select, update on public.mcp_access_grants to authenticated;
grant select on public.mcp_tool_invocations to authenticated;
grant all on public.mcp_oauth_clients to service_role;
grant all on public.mcp_authorization_codes to service_role;
grant all on public.mcp_access_grants to service_role;
grant all on public.mcp_tool_invocations to service_role;
grant all on public.mcp_resolution_tokens to service_role;

create policy "mcp_clients_select_linked" on public.mcp_oauth_clients
  for select using (
    exists (
      select 1
      from public.mcp_access_grants grant_row
      where grant_row.client_id = mcp_oauth_clients.client_id
        and grant_row.user_id = auth.uid()
    )
  );

create policy "mcp_grants_select_own" on public.mcp_access_grants
  for select using (user_id = auth.uid());

create policy "mcp_grants_revoke_own" on public.mcp_access_grants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "mcp_invocations_select_own_or_clinic_admin" on public.mcp_tool_invocations
  for select using (
    user_id = auth.uid()
    or (public.has_role(array['admin']) and public.is_same_clinic(clinic_id))
  );

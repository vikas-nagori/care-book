-- Stop the v2 billing RPCs from returning raw Postgres error text to the client.
--
-- Every `exception when others then` handler in the billing RPCs returns
-- `jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm)`. For the
-- codes the RPCs raise themselves (22023 / 42501 / P0001 / 40001 / 23505) `sqlerrm` is a
-- developer-authored sentence meant for the user. For anything else it is raw Postgres
-- internals — constraint names, check expressions, column names — handed to the caller.
--
-- `private.billing_error_response` passes the intentional messages through unchanged and
-- collapses everything else to a stable generic message, logging the real text server-side at
-- warning level so it still reaches the Postgres logs for debugging.

create or replace function private.billing_error_response(p_sqlstate text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  -- Codes this codebase raises on purpose. Their messages are written for the end user and
  -- carry no schema detail, so they stay intact.
  if p_sqlstate in ('22023', '42501', 'P0001', '40001', '23505') then
    return jsonb_build_object('success', false, 'errorCode', p_sqlstate, 'message', p_message);
  end if;

  raise warning 'billing rpc failure [%]: %', p_sqlstate, p_message;
  return jsonb_build_object(
    'success', false,
    'errorCode', 'BILLING_MUTATION_FAILED',
    'message', 'Something went wrong saving this billing change. Nothing was recorded; please try again.'
  );
end;
$$;

revoke all on function private.billing_error_response(text, text) from public, anon, authenticated;
grant execute on function private.billing_error_response(text, text) to service_role;

-- Rewrite every handler that leaks sqlerrm.
--
-- The bodies live across migrations 031/032/035 and run to hundreds of lines each; copying
-- them forward to edit two lines apiece is exactly how a guard gets silently dropped (the
-- risk migration 035's review had to rule out by hand). Editing the live definition read back
-- from pg_get_functiondef cannot drop anything: `create or replace` from that text preserves
-- the argument list, security definer, search_path, volatility, owner and grants, and the only
-- difference is the literal being replaced. The replacement is a fixed string, not a value
-- derived from any caller input.
do $rewrite$
declare
  target record;
  old_expression constant text :=
    $old$jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm)$old$;
  new_expression constant text := $new$private.billing_error_response(sqlstate, sqlerrm)$new$;
  rewritten integer := 0;
begin
  for target in
    select procedure_row.oid, pg_get_functiondef(procedure_row.oid) as definition
    from pg_proc procedure_row
    join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname in ('public', 'private')
      and procedure_row.prokind = 'f'
      -- plpgsql only: never read back a C function installed by an extension into public.
      and procedure_row.prolang = (select oid from pg_language where lanname = 'plpgsql')
      and position(old_expression in pg_get_functiondef(procedure_row.oid)) > 0
  loop
    execute replace(target.definition, old_expression, new_expression);
    rewritten := rewritten + 1;
  end loop;

  raise notice 'sanitized % billing exception handler(s)', rewritten;
end
$rewrite$;

-- Fail the migration if anything still returns sqlerrm to the caller.
do $verify$
declare
  leaking text[];
begin
  select coalesce(array_agg(namespace_row.nspname || '.' || procedure_row.proname), array[]::text[])
  into leaking
  from pg_proc procedure_row
  join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname in ('public', 'private')
    and procedure_row.prokind = 'f'
    and procedure_row.prolang = (select oid from pg_language where lanname = 'plpgsql')
    and pg_get_functiondef(procedure_row.oid) like '%''message'', sqlerrm%';

  if array_length(leaking, 1) > 0 then
    raise exception 'billing error sanitization missed: %', array_to_string(leaking, ', ');
  end if;
end
$verify$;

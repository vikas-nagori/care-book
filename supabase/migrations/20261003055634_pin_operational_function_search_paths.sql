-- Both helpers use only PostgreSQL builtins. Pin lookup independently of caller settings.
alter function public.update_updated_at() set search_path = pg_catalog;

-- Present on the hosted database as an operator-installed diagnostic helper, but not
-- in every clean installation. Do not introduce the helper where it does not exist.
do $$
begin
  if to_regprocedure('private.billing_fp_encode(text)') is not null then
    alter function private.billing_fp_encode(text) set search_path = pg_catalog;
  end if;
end
$$;

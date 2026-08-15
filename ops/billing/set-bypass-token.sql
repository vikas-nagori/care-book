\set ON_ERROR_STOP on

-- Required psql variable: bypass_token. This setting lasts only for the current connection.
-- Pass this file immediately before one reviewed migration in the same psql invocation.
set carebook.ops.bypass_token to :'bypass_token';

-- Re-sync seeded admin users in case the original backfill or role assignment drifted.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case
      when new.email in ('amrutakabra2512@gmail.com', 'vikasrnagori@gmail.com') then 'admin'
      else 'staff'
    end
  )
  on conflict (id) do update
    set email = excluded.email,
        role = excluded.role,
        updated_at = now();
  return new;
end;
$$;

insert into public.profiles (id, email, role)
select
  u.id,
  u.email,
  'admin'
from auth.users u
where u.email in ('amrutakabra2512@gmail.com', 'vikasrnagori@gmail.com')
on conflict (id) do update
  set email = excluded.email,
      role = excluded.role,
      updated_at = now();

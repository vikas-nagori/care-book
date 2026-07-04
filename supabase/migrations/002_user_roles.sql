-- Roles foundation. The seeded user is 'admin'; future users default to 'staff'.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('admin', 'staff')) default 'staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Any authenticated user can read profiles (matches current blanket-access posture).
create policy "profiles_read_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

-- Only admins can modify profiles (foundation for later admin-only role management UI).
create policy "profiles_write_admin" on public.profiles
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Auto-insert a profile row when a new auth user is created. Default role = 'staff';
-- specific emails are elevated to 'admin'.
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
      when new.email in ('vikasrnagori@gmail.com') then 'admin'
      else 'staff'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any users that already exist in auth.users.
insert into public.profiles (id, email, role)
select
  u.id,
  u.email,
  case
    when u.email in ('vikasrnagori@gmail.com') then 'admin'
    else 'staff'
  end
from auth.users u
on conflict (id) do update
  set role = excluded.role,
      email = excluded.email;

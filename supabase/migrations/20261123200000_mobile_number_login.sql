-- Mobile number + password becomes the primary sign-in. The number is exactly 10 digits
-- everywhere, with no country code: auth.users.phone (unique), profiles.mobile_number and
-- user_invites.mobile_number all hold the same string, as every existing profile row already does.
--
-- 1. Email becomes optional: a user may now exist with only a mobile number. Before this, the
--    new-user trigger copied a NULL email into the NOT NULL profiles.email and account creation
--    failed outright.
-- 2. The new-user trigger also records the mobile number on the placeholder profile.
-- 3. user_invites loses its client write path. Every write already goes through the service role
--    (settings/platform server actions); the FOR ALL policy let a clinic admin point an invite's
--    auth_user_id at any account, which the temp-password and revoke actions then reset or banned
--    (security review 2026-11-21, findings 1 and 2).

begin;

alter table public.profiles alter column email drop not null;

alter table public.user_invites alter column email drop not null;

alter table public.user_invites
  drop constraint if exists user_invites_contact_present;
alter table public.user_invites
  add constraint user_invites_contact_present
  check (email is not null or mobile_number is not null);

-- One live invite per mobile number. Revoked invites may repeat a number (re-invites reuse them).
create unique index if not exists user_invites_live_mobile_unique
  on public.user_invites (mobile_number)
  where mobile_number is not null and status in ('pending', 'accepted');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, mobile_number, role)
  values (
    new.id,
    new.email,
    -- auth.users.phone holds the 10-digit mobile number; anything else is not one of ours.
    case when new.phone ~ '^[6-9][0-9]{9}$' then new.phone end,
    case
      when new.email in ('vikasrnagori@gmail.com') then 'admin'
      else 'staff'
    end
  )
  on conflict (id) do update
    set email = excluded.email,
        mobile_number = coalesce(excluded.mobile_number, public.profiles.mobile_number),
        role = excluded.role,
        updated_at = now();
  return new;
end;
$$;

drop policy if exists "user_invites_tenant_admin_write" on public.user_invites;
revoke insert, update, delete on public.user_invites from anon, authenticated;

commit;

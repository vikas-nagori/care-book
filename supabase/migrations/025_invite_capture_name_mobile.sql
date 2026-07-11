-- Capture the invited user's name and mobile number at invite time so they are
-- not re-requested on the password-setup screen. Nullable to tolerate legacy
-- pending invites created before this migration.

alter table public.user_invites
  add column if not exists full_name text,
  add column if not exists mobile_number text;

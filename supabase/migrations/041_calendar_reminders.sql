-- Clinic-shared calendar follow-ups, independent of appointments and billing.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  patient_id uuid references public.patients(id) on delete set null,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 200),
  date date not null check (date between date '0001-01-01' and date '9999-12-31'),
  time time without time zone check (time < time '24:00' and extract(second from time) = 0),
  contact_name text check (char_length(contact_name) <= 200),
  phone text check (char_length(phone) <= 50),
  notes text check (char_length(notes) <= 5000),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reminders_clinic_date_idx on public.reminders(clinic_id, date, status);
create index reminders_patient_idx on public.reminders(patient_id) where patient_id is not null;

create function private.guard_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Reminder clinic cannot be changed' using errcode = '23514';
    end if;
    -- Allow the FK's SET NULL after a hard profile deletion, but reject direct
    -- attempts to clear or replace attribution while the creator still exists.
    if new.created_by is distinct from old.created_by and not (
      new.created_by is null and old.created_by is not null
      and not exists (select 1 from public.profiles where id = old.created_by)
    ) then
      raise exception 'Reminder creator cannot be changed' using errcode = '23514';
    end if;
    new.created_at := old.created_at;
  end if;

  if new.patient_id is not null and not exists (
    select 1 from public.patients patient
    where patient.id = new.patient_id and patient.clinic_id = new.clinic_id
  ) then
    raise exception 'Patient must belong to the reminder clinic' using errcode = '23514';
  end if;
  new.title := btrim(new.title);
  new.contact_name := nullif(btrim(new.contact_name), '');
  new.phone := nullif(btrim(new.phone), '');
  new.notes := nullif(btrim(new.notes), '');
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.guard_reminder() from public, anon, authenticated;
create trigger guard_reminder before insert or update on public.reminders
  for each row execute function private.guard_reminder();

alter table public.reminders enable row level security;
grant select, insert, update, delete on public.reminders to authenticated;
grant all on public.reminders to service_role;
revoke all on public.reminders from anon;

create policy reminders_read on public.reminders for select to authenticated
  using (private.is_same_clinic(clinic_id) and private.has_role(array['admin', 'staff']));
create policy reminders_create on public.reminders for insert to authenticated
  with check (
    private.is_same_clinic(clinic_id) and private.has_role(array['admin', 'staff'])
    and created_by = auth.uid()
  );
create policy reminders_update on public.reminders for update to authenticated
  using (private.is_same_clinic(clinic_id) and private.has_role(array['admin', 'staff']))
  with check (private.is_same_clinic(clinic_id) and private.has_role(array['admin', 'staff']));
create policy reminders_delete on public.reminders for delete to authenticated
  using (private.is_same_clinic(clinic_id) and private.has_role(array['admin', 'staff']));

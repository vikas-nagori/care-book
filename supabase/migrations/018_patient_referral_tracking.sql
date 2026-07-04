-- Track how a patient was referred: walk-in, another doctor, or other.
-- Doctors are stored as reusable records so a referring doctor's specialty and
-- address are captured once (the first time they're referenced) and picked from
-- a searchable list thereafter.

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  specialty text,
  address text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctors_name_present check (length(btrim(name)) > 0)
);

-- Case-insensitive unique doctor name to avoid duplicate entries.
create unique index if not exists doctors_name_unique
  on public.doctors(lower(btrim(name)));

alter table public.doctors enable row level security;

drop policy if exists "doctors_staff_admin_access" on public.doctors;

-- Staff and admins manage doctors, matching patient access (staff create
-- patients and therefore need to create/pick referring doctors).
create policy "doctors_staff_admin_access" on public.doctors
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

alter table public.patients
  add column if not exists referral_source text
    check (referral_source in ('walk_in', 'doctor', 'other')),
  add column if not exists referred_by_doctor_id uuid
    references public.doctors(id) on delete set null;

create index if not exists idx_patients_referred_by_doctor_id
  on public.patients(referred_by_doctor_id);

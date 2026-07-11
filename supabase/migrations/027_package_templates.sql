-- Admin-configurable package templates. Admins define reusable templates
-- (name, minimum sessions, per-session rate) in Settings; the billing entry form
-- pre-fills from a selected template. Templates only feed the form — recording a
-- package still goes through record_billing_entry unchanged, so packages stay
-- prepaid-only. Per-clinic, admin-write, mirroring external_staff's RLS.

create table if not exists public.package_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  min_sessions integer not null check (min_sessions > 0),
  per_session_amount numeric(10,2) not null default 0 check (per_session_amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists package_templates_clinic_idx
  on public.package_templates (clinic_id, created_at desc);

alter table public.package_templates enable row level security;

drop policy if exists "package_templates_tenant_read_staff_admin" on public.package_templates;
drop policy if exists "package_templates_tenant_write_admin" on public.package_templates;

create policy "package_templates_tenant_read_staff_admin" on public.package_templates
  for select
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']));

create policy "package_templates_tenant_write_admin" on public.package_templates
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

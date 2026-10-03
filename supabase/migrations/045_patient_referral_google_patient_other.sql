-- Two more referral sources, and somewhere to record the detail behind them.
--
-- Migration 018 tracked referrals as walk_in / doctor / other. Clinics also hear from patients who
-- found their Google page or were sent by an existing patient, and "Other" carried no detail at all,
-- so the clinic could never see a pattern in it.
--
--   * referral_source gains 'google' and 'patient'.
--   * referred_by_patient_id links the existing patient who made the referral. It clears (rather than
--     blocking or cascading) if that patient is deleted, mirroring referred_by_doctor_id.
--   * referral_other is the free text typed for an "Other" referral.
--
-- Each detail column is only meaningful for its own source, so a check keeps them from drifting out
-- of sync when the source changes. Existing 'other' rows simply have no text.

alter table public.patients drop constraint if exists patients_referral_source_check;
alter table public.patients add constraint patients_referral_source_check
  check (referral_source in ('walk_in', 'doctor', 'google', 'patient', 'other'));

alter table public.patients
  add column if not exists referred_by_patient_id uuid references public.patients(id) on delete set null,
  add column if not exists referral_other text;

alter table public.patients drop constraint if exists patients_referred_by_patient_source;
alter table public.patients add constraint patients_referred_by_patient_source
  check (referred_by_patient_id is null or referral_source = 'patient');
alter table public.patients drop constraint if exists patients_referred_by_patient_not_self;
alter table public.patients add constraint patients_referred_by_patient_not_self
  check (referred_by_patient_id is distinct from id);
alter table public.patients drop constraint if exists patients_referral_other_source;
alter table public.patients add constraint patients_referral_other_source
  check (referral_other is null or (referral_source = 'other' and char_length(referral_other) <= 200));

create index if not exists idx_patients_referred_by_patient_id
  on public.patients(referred_by_patient_id);

-- A referral must stay inside the clinic. RLS already hides other clinics' patients from the picker,
-- but a direct API write could still name one, so check against the row's own clinic. Security
-- definer so the lookup sees the referrer even where RLS would hide it, which is the case to refuse.
create or replace function private.validate_patient_referrer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.referred_by_patient_id is not null and not exists (
    select 1 from public.patients referrer
    where referrer.id = new.referred_by_patient_id
      and referrer.clinic_id = new.clinic_id
  ) then
    raise exception 'The referring patient must be from the same clinic.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_patient_referrer() from public, anon, authenticated;

-- Named to sort after patients_set_clinic_id: BEFORE triggers fire alphabetically, and the clinic
-- must already be stamped on the new row before it is compared.
drop trigger if exists patients_validate_referrer on public.patients;
create trigger patients_validate_referrer
  before insert or update of referred_by_patient_id, clinic_id on public.patients
  for each row execute function private.validate_patient_referrer();

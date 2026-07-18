-- Support deterministic, newest-first appointment history pagination per patient.
create index if not exists appointments_patient_history_idx
  on public.appointments (patient_id, date desc, time desc, id desc);

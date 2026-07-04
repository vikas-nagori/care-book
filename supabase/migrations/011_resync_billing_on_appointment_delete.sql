-- Re-sync a patient's billing allocations when one of their appointments is deleted.
--
-- The allocation engine in 009 wires sync_patient_billing_allocations() only to
-- INSERT/UPDATE on appointments, so a hard delete (e.g. deleting a scheduled
-- appointment) leaves packages.used_sessions overcounted and frees payment credit that
-- is never re-allocated. sync_patient_billing_allocations() already handles tg_op =
-- 'DELETE' (it reads old.patient_id), so only the trigger wiring is missing.
--
-- FK cascades remove the appointment's appointment_payments / package_session_allocations
-- rows as part of the delete, so by the time this AFTER DELETE trigger runs the re-sync
-- recounts package usage and re-allocates freed credit against the patient's remaining
-- appointments correctly.

drop trigger if exists appointments_delete_sync_billing on public.appointments;
create trigger appointments_delete_sync_billing
  after delete on public.appointments
  for each row execute function public.sync_patient_billing_allocations();

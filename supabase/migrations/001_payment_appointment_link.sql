-- supabase/migrations/001_payment_appointment_link.sql

-- 1. Global settings table (single row, id always = 1)
CREATE TABLE global_settings (
  id            integer PRIMARY KEY DEFAULT 1,
  home_visit_fee numeric(10,2) NOT NULL DEFAULT 0,
  clinic_fee     numeric(10,2) NOT NULL DEFAULT 0,
  CHECK (id = 1)
);
INSERT INTO global_settings DEFAULT VALUES;

-- RLS
ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users can read/write global_settings"
  ON global_settings FOR ALL
  USING (auth.role() = 'authenticated');

-- 2. Add fee + payment_status to appointments
ALTER TABLE appointments
  ADD COLUMN fee            numeric(10,2),
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'prepaid', 'paid'));

-- 3. Appointment payments junction table
CREATE TABLE appointment_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, appointment_id)
);

ALTER TABLE appointment_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users can read/write appointment_payments"
  ON appointment_payments FOR ALL
  USING (auth.role() = 'authenticated');

-- Index for fast lookups
CREATE INDEX idx_appointment_payments_payment_id ON appointment_payments(payment_id);
CREATE INDEX idx_appointment_payments_appointment_id ON appointment_payments(appointment_id);
CREATE INDEX idx_appointments_payment_status ON appointments(payment_status);

-- 4. pg_cron: auto-complete appointments at 23:59 IST (18:29 UTC) daily
-- MANUAL STEP: Run this in Supabase SQL Editor after enabling the pg_cron extension
-- (Database → Extensions → pg_cron → Enable)
--
-- SELECT cron.schedule(
--   'auto-complete-appointments',
--   '29 18 * * *',
--   $$
--     UPDATE appointments
--     SET status = 'completed'
--     WHERE status = 'scheduled'
--       AND (date::text || ' ' || SPLIT_PART(time::text, '+', 1))::timestamp
--           < (NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp
--   $$
-- );
--
-- Verify with: SELECT * FROM cron.job;

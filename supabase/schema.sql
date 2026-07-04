-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Patients
create table patients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text not null,
  email text,
  dob date,
  gender text check (gender in ('male', 'female', 'other')),
  address text,
  medical_history text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Appointments
create table appointments (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid references patients(id) on delete cascade not null,
  date date not null,
  time time not null,
  duration_minutes integer default 45,
  type text check (type in ('home_visit', 'clinic')) default 'clinic',
  status text check (status in ('scheduled', 'completed', 'cancelled')) default 'scheduled',
  notes text,
  created_at timestamptz default now()
);

-- Treatment Plans
create table treatment_plans (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid references patients(id) on delete cascade not null,
  diagnosis text not null,
  goals text,
  start_date date not null,
  expected_end_date date,
  status text check (status in ('active', 'completed', 'discontinued')) default 'active',
  created_at timestamptz default now()
);

-- Session Notes (SOAP format)
create table session_notes (
  id uuid primary key default uuid_generate_v4(),
  appointment_id uuid references appointments(id) on delete cascade not null,
  subjective text,
  objective text,
  assessment text,
  plan text,
  exercises_prescribed text,
  created_at timestamptz default now()
);

-- Packages
create table packages (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid references patients(id) on delete cascade not null,
  name text not null,
  total_sessions integer not null,
  used_sessions integer default 0,
  total_amount numeric(10,2) not null,
  paid_amount numeric(10,2) default 0,
  payment_timing text check (payment_timing in ('prepaid', 'postpaid')) default 'prepaid',
  status text check (status in ('active', 'completed', 'cancelled')) default 'active',
  created_at timestamptz default now()
);

-- Payments
create table payments (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid references patients(id) on delete cascade not null,
  package_id uuid references packages(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  amount numeric(10,2) not null,
  payment_method text not null,
  date date not null,
  notes text,
  created_at timestamptz default now()
);

-- Row Level Security
alter table patients enable row level security;
alter table appointments enable row level security;
alter table treatment_plans enable row level security;
alter table session_notes enable row level security;
alter table packages enable row level security;
alter table payments enable row level security;

-- Policies (allow authenticated users full access - single user app)
create policy "Authenticated users can do anything" on patients for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do anything" on appointments for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do anything" on treatment_plans for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do anything" on session_notes for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do anything" on packages for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do anything" on payments for all using (auth.role() = 'authenticated');

-- Updated_at trigger for patients
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger patients_updated_at
  before update on patients
  for each row execute function update_updated_at();

-- Indexes
create index idx_appointments_patient_id on appointments(patient_id);
create index idx_appointments_date on appointments(date);
create index idx_treatment_plans_patient_id on treatment_plans(patient_id);
create index idx_session_notes_appointment_id on session_notes(appointment_id);
create index idx_packages_patient_id on packages(patient_id);
create index idx_payments_patient_id on payments(patient_id);

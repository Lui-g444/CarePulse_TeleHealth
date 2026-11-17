-- CarePulse database schema
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query),
-- then reload the API schema cache:
--
--   notify pgrst, 'reload schema';
--
-- The script is idempotent: tables, indexes, functions and policies are all
-- created only when missing, so it is safe to re-run after pulling changes.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, carries the app role.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  phone text,
  gender text,
  role text not null default 'patient'
    check (role in ('patient', 'doctor', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  add column if not exists gender text;

-- ---------------------------------------------------------------------------
-- doctors — the bookable directory. `id` is the doctor's auth user id.
-- ---------------------------------------------------------------------------
create table if not exists public.doctors (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  specialty text not null default 'General practice',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- doctor_schedules — weekly availability, one row per working weekday.
-- `saveWeeklyHours` replaces a single day at a time, hence the unique key.
-- ---------------------------------------------------------------------------
create table if not exists public.doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday, matching JavaScript's getDay().
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_duration_minutes integer not null default 30
    check (slot_duration_minutes between 10 and 180),
  unique (doctor_id, day_of_week),
  check (end_time > start_time)
);

-- ---------------------------------------------------------------------------
-- appointments — one row per booked slot.
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  cancelled_by uuid references auth.users (id),
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.appointments
  add column if not exists cancelled_by uuid references auth.users (id);

alter table public.appointments
  add column if not exists cancellation_reason text;

alter table public.appointments
  add column if not exists cancelled_at timestamptz;

-- Video-call request: a patient may ask for a telehealth consultation;
-- the doctor decides whether to start it.
alter table public.appointments
  add column if not exists video_requested boolean not null default false;

alter table public.appointments
  add column if not exists video_requested_at timestamptz;

-- Patient follow-up note about a consultation (besides video).
alter table public.appointments
  add column if not exists patient_note text;

alter table public.appointments
  add column if not exists patient_note_at timestamptz;

-- Projects created before `end_time` was part of the schema: add the column,
-- backfill existing rows from the slot length, then enforce it.
alter table public.appointments
  add column if not exists end_time time;

update public.appointments
set end_time = start_time + interval '30 minutes'
where end_time is null;

alter table public.appointments
  alter column end_time set not null;

-- The insert in `bookAppointment` relies on this index to reject a second
-- booking of the same slot (error code 23505). Cancelled rows free the slot.
create unique index if not exists appointments_unique_slot
  on public.appointments (doctor_id, appointment_date, start_time)
  where status <> 'cancelled';

create index if not exists appointments_patient_date_idx
  on public.appointments (patient_id, appointment_date desc);

create index if not exists appointments_doctor_date_idx
  on public.appointments (doctor_id, appointment_date);

create index if not exists appointments_date_idx
  on public.appointments (appointment_date);

-- ---------------------------------------------------------------------------
-- consultations — the doctor's record for a completed appointment.
-- The unique key on appointment_id makes the upsert idempotent.
-- ---------------------------------------------------------------------------
create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique
    references public.appointments (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  patient_id uuid not null references auth.users (id) on delete cascade,
  diagnosis text not null,
  notes text,
  prescriptions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Projects created before `prescriptions` was part of the schema: add the
-- column (and backfill) so an upsert from `completeConsultation` does not fail
-- with "Could not find the 'prescriptions' column ... in the schema cache".
alter table public.consultations
  add column if not exists prescriptions jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- appointment_feed — a masked mirror of upcoming appointments for the public
-- landing page. Only initials are copied here, never patient names, email or
-- clinical data, so the marketing page can show a real live queue without
-- exposing who the patients are.
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_feed (
  appointment_id uuid primary key
    references public.appointments (id) on delete cascade,
  doctor_id uuid not null,
  appointment_date date not null,
  start_time time not null,
  status text not null,
  patient_initials text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists appointment_feed_date_idx
  on public.appointment_feed (appointment_date, start_time);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.doctors enable row level security;
alter table public.doctor_schedules enable row level security;
alter table public.appointments enable row level security;
alter table public.consultations enable row level security;
alter table public.appointment_feed enable row level security;

-- Role checks run as the function owner so they can read `profiles` without
-- recursing into the policy on that table.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_doctor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.doctors
    where id = auth.uid()
  );
$$;

-- profiles --------------------------------------------------------------
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "profiles: staff read all" on public.profiles;
create policy "profiles: staff read all"
  on public.profiles for select to authenticated
  using (public.is_admin() or public.is_doctor());

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert to authenticated
  with check (id = auth.uid() and role in ('patient', 'doctor'));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "profiles: admin update all" on public.profiles;
create policy "profiles: admin update all"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- doctors ---------------------------------------------------------------
drop policy if exists "doctors: read all" on public.doctors;
create policy "doctors: read all"
  on public.doctors for select to anon, authenticated
  using (true);

drop policy if exists "doctors: admin write" on public.doctors;
create policy "doctors: admin write"
  on public.doctors for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- doctor_schedules ------------------------------------------------------
-- Patients must read availability to build the booking slots.
drop policy if exists "schedules: read all" on public.doctor_schedules;
create policy "schedules: read all"
  on public.doctor_schedules for select to authenticated
  using (true);

drop policy if exists "schedules: doctor write own" on public.doctor_schedules;
create policy "schedules: doctor write own"
  on public.doctor_schedules for all to authenticated
  using (doctor_id = auth.uid() or public.is_admin())
  with check (doctor_id = auth.uid() or public.is_admin());

-- appointments ----------------------------------------------------------
drop policy if exists "appointments: read own" on public.appointments;
create policy "appointments: read own"
  on public.appointments for select to authenticated
  using (
    patient_id = auth.uid()
    or doctor_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "appointments: patient insert own" on public.appointments;
create policy "appointments: patient insert own"
  on public.appointments for insert to authenticated
  with check (patient_id = auth.uid());

drop policy if exists "appointments: doctor update own" on public.appointments;
create policy "appointments: doctor update own"
  on public.appointments for update to authenticated
  using (doctor_id = auth.uid() or public.is_admin())
  with check (doctor_id = auth.uid() or public.is_admin());

drop policy if exists "appointments: admin delete" on public.appointments;
create policy "appointments: admin delete"
  on public.appointments for delete to authenticated
  using (public.is_admin());

-- consultations ---------------------------------------------------------
drop policy if exists "consultations: read participants" on public.consultations;
create policy "consultations: read participants"
  on public.consultations for select to authenticated
  using (
    doctor_id = auth.uid()
    or patient_id = auth.uid()
    or public.is_admin()
    or (
      public.is_doctor()
      and exists (
        select 1
        from public.appointments a
        where a.patient_id = consultations.patient_id
          and a.doctor_id = auth.uid()
      )
    )
  );

drop policy if exists "consultations: doctor write own" on public.consultations;
create policy "consultations: doctor write own"
  on public.consultations for all to authenticated
  using (doctor_id = auth.uid())
  with check (doctor_id = auth.uid());

-- appointment_feed ------------------------------------------------------
-- Everyone may read the already-masked feed; only the trigger below writes it.
drop policy if exists "appointment_feed: public read" on public.appointment_feed;
create policy "appointment_feed: public read"
  on public.appointment_feed for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Keep the feed in step with bookings. The function runs as its owner, so it
-- can read `profiles` to derive initials without granting that table to anon.
-- ---------------------------------------------------------------------------
create or replace function public.initials_for(patient uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- Always returns one row: patients without a profile (or a name) show as
  -- "P" rather than breaking the appointment insert that fired the trigger.
  select coalesce(
    (
      select nullif(
        upper(
          coalesce(left(split_part(trim(p.full_name), ' ', 1), 1), '') ||
          coalesce(left(split_part(trim(p.full_name), ' ', 2), 1), '')
        ),
        ''
      )
      from public.profiles p
      where p.id = patient
    ),
    'P'
  );
$$;

-- Helper functions are for the trigger only; keep them off the REST API.
revoke all on function public.initials_for(uuid) from public, anon, authenticated;

create or replace function public.sync_appointment_feed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.appointment_feed where appointment_id = old.id;
    return old;
  end if;

  insert into public.appointment_feed (
    appointment_id, doctor_id, appointment_date, start_time, status,
    patient_initials, updated_at
  )
  values (
    new.id, new.doctor_id, new.appointment_date, new.start_time, new.status,
    public.initials_for(new.patient_id), now()
  )
  on conflict (appointment_id) do update set
    doctor_id = excluded.doctor_id,
    appointment_date = excluded.appointment_date,
    start_time = excluded.start_time,
    status = excluded.status,
    patient_initials = excluded.patient_initials,
    updated_at = now();

  return null;
end;
$$;

drop trigger if exists appointments_sync_feed on public.appointments;
create trigger appointments_sync_feed
  after insert or update or delete on public.appointments
  for each row execute function public.sync_appointment_feed();

revoke all on function public.sync_appointment_feed() from public, anon, authenticated;

-- Backfill the feed for appointments that existed before the trigger.
insert into public.appointment_feed (
  appointment_id, doctor_id, appointment_date, start_time, status,
  patient_initials
)
select
  a.id,
  a.doctor_id,
  a.appointment_date,
  a.start_time,
  a.status,
  public.initials_for(a.patient_id)
from public.appointments a
on conflict (appointment_id) do update set
  doctor_id = excluded.doctor_id,
  appointment_date = excluded.appointment_date,
  start_time = excluded.start_time,
  status = excluded.status,
  patient_initials = excluded.patient_initials,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Privileges (RLS still decides which rows each role can touch)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public
  to authenticated;
-- The landing page's live queue is readable without a session.
grant select on public.appointment_feed to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime — the doctor dashboard subscribes to appointment changes.
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.appointments;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- The landing page subscribes to this feed to keep its queue current.
do $$
begin
  alter publication supabase_realtime add table public.appointment_feed;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- patient_intakes — structured clinical context captured during booking.
-- One row per appointment; patients write their own, doctors/admins read.
-- ---------------------------------------------------------------------------
create table if not exists public.patient_intakes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique
    references public.appointments (id) on delete cascade,
  patient_id uuid not null references auth.users (id) on delete cascade,
  chief_complaint text not null,
  symptom_description text,
  onset text,
  duration text,
  severity smallint check (severity between 1 and 10),
  medications text,
  allergies text,
  red_flag boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists patient_intakes_patient_idx
  on public.patient_intakes (patient_id, created_at desc);

alter table public.patient_intakes enable row level security;

drop policy if exists "intakes: read participants" on public.patient_intakes;
create policy "intakes: read participants"
  on public.patient_intakes for select to authenticated
  using (
    patient_id = auth.uid()
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_id and (a.doctor_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "intakes: patient insert own" on public.patient_intakes;
create policy "intakes: patient insert own"
  on public.patient_intakes for insert to authenticated
  with check (
    patient_id = auth.uid()
    and exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.patient_id = auth.uid()
    )
  );

drop policy if exists "intakes: patient update own" on public.patient_intakes;
create policy "intakes: patient update own"
  on public.patient_intakes for update to authenticated
  using (patient_id = auth.uid())
  with check (patient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Patient cancellation: a patient may cancel their own pending/confirmed visit.
-- ---------------------------------------------------------------------------
drop policy if exists "appointments: patient cancel own" on public.appointments;
create policy "appointments: patient cancel own"
  on public.appointments for update to authenticated
  using (patient_id = auth.uid() and status in ('pending', 'confirmed'))
  with check (patient_id = auth.uid() and status = 'cancelled');

-- Patient may flag an appointment as requesting a video consultation without
-- changing its status (distinct from the cancel policy above).
drop policy if exists "appointments: patient request video own" on public.appointments;
create policy "appointments: patient request video own"
  on public.appointments for update to authenticated
  using (patient_id = auth.uid() and status in ('pending', 'confirmed'))
  with check (patient_id = auth.uid() and status in ('pending', 'confirmed'));

-- ---------------------------------------------------------------------------
-- appointment_messages — 1-on-1 chat between patient and doctor per visit.
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_messages (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists appointment_messages_appointment_idx
  on public.appointment_messages (appointment_id, created_at);

drop policy if exists "appointment_messages: read participants" on public.appointment_messages;
create policy "appointment_messages: read participants"
  on public.appointment_messages for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and (a.patient_id = auth.uid() or a.doctor_id = auth.uid())
    )
  );

drop policy if exists "appointment_messages: insert participants" on public.appointment_messages;
create policy "appointment_messages: insert participants"
  on public.appointment_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and (a.patient_id = auth.uid() or a.doctor_id = auth.uid())
    )
  );

drop policy if exists "appointment_messages: mark read" on public.appointment_messages;
create policy "appointment_messages: mark read"
  on public.appointment_messages for update to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and (a.patient_id = auth.uid() or a.doctor_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and (a.patient_id = auth.uid() or a.doctor_id = auth.uid())
    )
  );

-- Enable realtime for chat.
do $$
begin
  alter publication supabase_realtime add table public.appointment_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- direct_messages — private 1-on-1 chat between an admin and a user.
-- Patients/doctors may only message admins; admins may message anyone.
-- ---------------------------------------------------------------------------
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists direct_messages_thread_idx
  on public.direct_messages (sender_id, recipient_id, created_at);

create index if not exists direct_messages_recipient_idx
  on public.direct_messages (recipient_id, read_at);

alter table public.direct_messages enable row level security;

drop policy if exists "direct_messages: read participants" on public.direct_messages;
create policy "direct_messages: read participants"
  on public.direct_messages for select to authenticated
  using (
    sender_id = auth.uid()
    or recipient_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "direct_messages: insert participants" on public.direct_messages;
create policy "direct_messages: insert participants"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      public.is_admin()
      or exists (
        select 1 from public.profiles p
        where p.id = recipient_id and p.role = 'admin'
      )
    )
  );

drop policy if exists "direct_messages: mark read" on public.direct_messages;
create policy "direct_messages: mark read"
  on public.direct_messages for update to authenticated
  using (
    recipient_id = auth.uid() or public.is_admin()
  )
  with check (
    recipient_id = auth.uid() or public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- announcements — admin broadcasts to patients, doctors, or everyone.
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  title text,
  body text not null,
  target_role text not null default 'all'
    check (target_role in ('all', 'patient', 'doctor')),
  created_at timestamptz not null default now()
);

create index if not exists announcements_created_idx
  on public.announcements (created_at desc);

alter table public.announcements enable row level security;

drop policy if exists "announcements: read" on public.announcements;
create policy "announcements: read"
  on public.announcements for select to authenticated
  using (
    target_role = 'all'
    or target_role = (select p.role from public.profiles p where p.id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "announcements: admin insert" on public.announcements;
create policy "announcements: admin insert"
  on public.announcements for insert to authenticated
  with check (public.is_admin() and sender_id = auth.uid());

drop policy if exists "announcements: admin delete" on public.announcements;
create policy "announcements: admin delete"
  on public.announcements for delete to authenticated
  using (public.is_admin());

-- Realtime for the new tables.
do $$
begin
  alter publication supabase_realtime add table public.direct_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.announcements;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Pick up the new tables in PostgREST immediately.
notify pgrst, 'reload schema';

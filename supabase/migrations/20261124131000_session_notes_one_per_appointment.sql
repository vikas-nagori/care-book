-- G-4: one session note per appointment.
--
-- Saving Session Notes a second time after a lost reply (or a double tap on a phone) inserted a
-- second session_notes row for the same appointment: nothing made appointment_id unique. The
-- appointment page then read the note with .maybeSingle(), which fails on two rows, so it showed
-- no notes at all, and the next "Add Notes" inserted yet another row.
--
-- What this migration does, in one transaction:
--   1. For every appointment that has more than one note, the NEWEST note (created_at, then id,
--      descending) is kept exactly as it is. That is the note the fixed app shows and edits.
--   2. Every OLDER duplicate is MOVED, not dropped: it is copied with all its columns into
--      private.session_notes_duplicates_archive (plus the id of the note that was kept and the
--      time it was archived) and only then removed from public.session_notes. The number moved is
--      reported with RAISE NOTICE. The archive lives in the private schema, so it is not exposed
--      through the API; review it with SQL as the service role. Archived rows follow their
--      appointment: they are deleted with it, like session notes are.
--   3. Replaces the plain index on session_notes(appointment_id) with a unique one, so a second
--      note for an appointment is refused (23505). The app writes to the existing note instead.
--
-- Rollback: drop index public.session_notes_one_per_appointment; create index
-- idx_session_notes_appointment_id on public.session_notes(appointment_id); archived rows can be
-- copied back from the archive table.

create table if not exists private.session_notes_duplicates_archive (
  id uuid primary key,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  subjective text,
  objective text,
  assessment text,
  plan text,
  exercises_prescribed text,
  created_at timestamptz,
  kept_note_id uuid not null,
  archived_at timestamptz not null default now()
);
comment on table private.session_notes_duplicates_archive is
  'Older duplicate session notes moved out of public.session_notes by migration 20261124131000 (G-4); kept_note_id is the note left in place for the appointment.';
revoke all on table private.session_notes_duplicates_archive from public, anon, authenticated;

do $$
declare
  v_moved integer;
begin
  -- No note may be added or changed while duplicates are resolved and the index is built.
  lock table public.session_notes in share row exclusive mode;

  with ranked as (
    select
      n.*,
      first_value(n.id) over w as kept_id,
      row_number() over w as position
    from public.session_notes n
    window w as (partition by n.appointment_id order by n.created_at desc nulls last, n.id desc)
  ),
  archived as (
    insert into private.session_notes_duplicates_archive
      (id, appointment_id, subjective, objective, assessment, plan, exercises_prescribed, created_at, kept_note_id)
    select id, appointment_id, subjective, objective, assessment, plan, exercises_prescribed, created_at, kept_id
    from ranked
    where position > 1
    returning id
  )
  delete from public.session_notes n
  using archived
  where n.id = archived.id;

  get diagnostics v_moved = row_count;
  if v_moved > 0 then
    raise notice 'session_notes: moved % older duplicate note(s) to private.session_notes_duplicates_archive', v_moved;
  end if;
end;
$$;

create unique index if not exists session_notes_one_per_appointment on public.session_notes (appointment_id);
drop index if exists public.idx_session_notes_appointment_id;

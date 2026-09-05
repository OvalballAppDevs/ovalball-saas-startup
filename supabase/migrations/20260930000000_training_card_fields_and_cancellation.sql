-- SIDE PROJECT 2 -- TRAINING MANAGEMENT EXTENSION: shared pitches (TS-only
-- fix, no migration needed -- see lib/pitch-allocation/training-conflicts.ts),
-- cancellation, agenda, further notes.
--
-- Canonical default agenda (Section 28) lives in exactly ONE place: this
-- column default. Every insert path (automatic generation, manual
-- scheduling, a future API) gets it for free with zero risk of the string
-- drifting between components.
alter table public.training_sessions
  add column agenda text not null default 'General rugby training focused on an age-appropriate warm-up, core rugby skills, handling and movement, decision-making, team play and a structured cool-down. Coaches may adapt the session to suit the team''s age group, current development priorities and upcoming rugby commitments.',
  add column further_notes text,
  -- Section 9/11: normalized cancellation metadata, never overloading the
  -- pre-existing generic `notes` field. cancelled_at/cancellation_reason
  -- already existed (Side Project 2 foundation); cancelled_by is new.
  add column cancelled_by uuid references auth.users(id);

alter table public.training_sessions
  add constraint training_sessions_agenda_length check (char_length(agenda) <= 4000),
  add constraint training_sessions_further_notes_length check (further_notes is null or char_length(further_notes) <= 2000),
  add constraint training_sessions_cancellation_reason_length check (cancellation_reason is null or char_length(cancellation_reason) <= 1000);

comment on column public.training_sessions.agenda is 'Coach-authored session plan, participant-visible (Section 27-30). Every new row gets the canonical default agenda via this column''s own DEFAULT -- never duplicated into application code.';
comment on column public.training_sessions.further_notes is 'Participant/family-visible logistics notes (Section 31-32) -- e.g. "bring gum shields", "meet at the clubhouse at 17:50". Explicitly NOT for safeguarding/medical/internal-staff content -- this field is shown to players, parents and guardians.';
comment on column public.training_sessions.cancelled_by is 'The real acting user who cancelled this occurrence or (for a plan-deletion-driven cancellation) triggered the plan deletion -- stable auth.users(id), never a display name. Null for a never-cancelled session.';

-- Section 9: cancellation reason becomes REQUIRED and non-blank going
-- forward for an explicit user-initiated cancellation (both the
-- session-level and plan-level paths reuse this same check, folded into
-- the RPCs themselves below rather than a table CHECK, since a
-- CHECK constraint cannot distinguish "explicit cancellation" from other
-- status transitions and must not block internal/system writes).

-- Extend the existing cancellation-sync trigger to also normalise
-- cancelled_by, so any future direct write (service-role tooling, a
-- migration backfill) can never leave status=CANCELLED with no actor.
create or replace function internal.sync_training_session_cancellation()
returns trigger
language plpgsql
as $function$
begin
  if new.status = 'CANCELLED' and new.cancelled_at is null then
    new.cancelled_at := now();
  elsif new.status = 'PLANNED' then
    new.cancelled_at := null;
    new.cancellation_reason := null;
    new.cancelled_by := null;
  elsif new.cancelled_at is not null and new.status <> 'CANCELLED' then
    new.status := 'CANCELLED';
  end if;
  return new;
end;
$function$;

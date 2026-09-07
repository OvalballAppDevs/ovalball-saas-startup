-- Meet / arrival time.
--
-- "Be there for 09:45, kick-off is 10:30" is one of the two facts a parent
-- actually needs from a fixture, and until now it existed only as free text
-- in notes -- unqueryable, unvalidatable, and invisible to the Calendar, the
-- Agenda and the Match Centre.
--
-- SHAPE
--
-- It follows the shape fixtures already use for kickoff: a bare `time`
-- alongside the fixture's own kickoff_date, not a second timestamptz. A
-- separate absolute timestamp would let meet time and kickoff drift onto
-- different days or different timezone interpretations of the same day,
-- which is exactly the class of bug that makes a parent arrive an hour late.
-- One date on the fixture, two times against it.
--
-- RULES, enforced in the database rather than in a form:
--
--   * meet time is optional -- most fixtures will never set one, and every
--     existing row keeps NULL;
--   * a meet time requires a kickoff time, because "arrive 45 minutes early"
--     is meaningless without the thing it is early for;
--   * meet time must be at or before kickoff. Not after. A fixture whose
--     meet time is after kickoff is not an edge case to render carefully,
--     it is data that cannot be true.

alter table public.fixtures
  add column meet_time time without time zone;

comment on column public.fixtures.meet_time is
  'Optional arrival/meet time, against the fixture''s own kickoff_date -- the same shape as kickoff_time. Must be <= kickoff_time, and requires one. Canonical: the Match Centre, Calendar, Agenda and fixture management all read THIS column; there is no Match-Centre-only meet time.';

-- NOT VALID is deliberately NOT used here: unlike an append-only ledger,
-- this column is brand new, so every existing row is NULL and trivially
-- satisfies the constraint. Validating now means the rule is true of the
-- whole table from the first day rather than only of future writes.
alter table public.fixtures
  add constraint fixtures_meet_time_requires_kickoff check (
    meet_time is null or kickoff_time is not null
  );

alter table public.fixtures
  add constraint fixtures_meet_time_not_after_kickoff check (
    meet_time is null or meet_time <= kickoff_time
  );

-- ---------------------------------------------------------------------------
-- Setting it
-- ---------------------------------------------------------------------------

-- Authority is the SAME check the rest of the schedule already uses
-- (internal.can_submit_fixture_result, plus Site Admin) -- meet time is part
-- of the schedule, not a new kind of thing with its own permission model.
--
-- A dedicated function rather than a new parameter on update_fixture_schedule
-- because that function's signature is consumed by several existing callers,
-- and widening it would make every one of them pass a value they do not have.
-- Both write the same canonical column.
create or replace function public.update_fixture_meet_time(
  p_fixture_id uuid,
  p_meet_time time without time zone
)
returns time without time zone
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  f public.fixtures;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to change the schedule for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  -- Checked here as well as in the CHECK constraints so the caller gets a
  -- sentence they can act on rather than a constraint-violation string.
  if p_meet_time is not null then
    if f.kickoff_time is null then
      raise exception 'Set a kick-off time before adding a meet time.';
    end if;
    if p_meet_time > f.kickoff_time then
      raise exception 'The meet time must be at or before kick-off.';
    end if;
  end if;

  update public.fixtures
  set meet_time = p_meet_time, updated_by = auth.uid(), updated_at = now()
  where id = p_fixture_id;

  return p_meet_time;
end;
$$;

revoke all on function public.update_fixture_meet_time(uuid, time without time zone) from public;
grant execute on function public.update_fixture_meet_time(uuid, time without time zone) to authenticated;

-- Rescheduling must never be blocked by a meet time, and an invalid meet
-- time must never be silently accepted. Those are different situations and
-- the trigger has to tell them apart.
--
-- Handled as a trigger rather than inside one RPC because kickoff_time is
-- reachable from several canonical paths (update_fixture_schedule, amendment
-- acceptance, imports), and each of them re-deriving this rule independently
-- is how the data would rot.
create or replace function internal.clear_meet_time_without_kickoff()
returns trigger
language plpgsql
set search_path = public, internal, pg_temp
as $$
begin
  -- No kickoff, no meet time. "Arrive 45 minutes early" is meaningless
  -- without the thing it is early for.
  if new.kickoff_time is null then
    new.meet_time := null;
    return new;
  end if;

  if new.meet_time is not null and new.meet_time > new.kickoff_time then
    -- THE KICKOFF MOVED. The schedule is the authoritative fact and the
    -- reschedule must succeed, so the now-stale meet time is dropped and the
    -- club is asked to set it again. Recognised by the kickoff changing while
    -- the meet time did not.
    if tg_op = 'UPDATE'
       and new.kickoff_time is distinct from old.kickoff_time
       and new.meet_time is not distinct from old.meet_time then
      new.meet_time := null;
      return new;
    end if;

    -- OTHERWISE somebody is writing a meet time that is after kick-off. That
    -- is not stale data to tidy up, it is wrong data, and silently nulling it
    -- would hide the mistake from whoever made it. Left untouched so the
    -- CHECK constraint rejects the write.
  end if;

  return new;
end;
$$;

create trigger fixtures_meet_time_consistency
  before insert or update of kickoff_time, meet_time on public.fixtures
  for each row execute function internal.clear_meet_time_without_kickoff();

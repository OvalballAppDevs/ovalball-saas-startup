-- =====================================================================================================
-- A TOURNAMENT RUNS FROM A TIME UNTIL A TIME.
--
-- `tournaments` carried `kickoff_time` and nothing else, so the only thing Ovalball could say about a
-- festival's hours was when it started. Every surface that needs to tell a family what Saturday looks
-- like -- the Calendar row, the Tournament Centre's details -- wants "09:00 - 14:30", because the
-- question a parent is actually asking is how long they are at a field for.
--
-- WHY A COLUMN AND NOT A DERIVATION. The obvious alternative is to take the end from the last pitch
-- reservation or the last scheduled game. Both are wrong for the case that matters: a tournament whose
-- plan has not been published yet has no games and no reservations, and it still has advertised hours
-- -- they are in the invitation the organiser sent out. A derived end would show nothing precisely
-- when a family is deciding whether they can go.
--
-- IT IS NULLABLE, AND MEANS "NOT STATED". A tournament whose organiser has not said when it finishes
-- shows a start and no end, rather than a guessed one. No surface may invent it.
--
-- `kickoff_time` KEEPS ITS NAME. It is the column every existing write already sets and every existing
-- read already reads; renaming it to `starts_at` for symmetry would be a migration that changes
-- nothing except how much has to be touched.
-- =====================================================================================================

alter table public.tournaments add column if not exists ends_at time without time zone;

comment on column public.tournaments.ends_at is
  'When the tournament finishes on a day it runs. NULL means the organiser has not said -- never a '
  'guess, and never derived from the last game or pitch reservation, both of which are empty before '
  'the plan is published.';

-- A SINGLE-DAY TOURNAMENT CANNOT FINISH BEFORE IT STARTS. Deliberately not applied to a multi-day one:
-- a festival running Saturday 09:00 to Sunday 14:30 has an end time EARLIER in the day than its start,
-- and that is correct rather than a mistake.
alter table public.tournaments drop constraint if exists tournaments_hours_are_in_order;
alter table public.tournaments
  add constraint tournaments_hours_are_in_order
  check (
    ends_at is null
    or kickoff_time is null
    or ends_on > event_date
    or ends_at > kickoff_time
  );

-- ---- the two canonical write paths both carry it ---------------------------------------------------
--
-- Added by rewriting the live definition rather than restating it: these functions are long, they are
-- owned by earlier migrations, and retyping them here is how two versions of one function come to
-- exist. Each rewrite is guarded so re-running this migration is a no-op.
--
-- EVERY ANCHOR BELOW IS LONG ENOUGH TO MATCH EXACTLY ONCE, and each replacement is verified before the
-- next is attempted. The first draft of this migration used `kickoff_time,` as an anchor; it also
-- matched inside `p_kickoff_time,` and inside `coalesce(p_kickoff_time, kickoff_time)`, and silently
-- produced a function with one too many values in its INSERT and a nonsense expression in its UPDATE.
-- A text rewrite of a function body is only safe when it cannot match a second time, so this one
-- refuses rather than guesses: `expect_one` raises if an anchor is absent or appears more than once.

create or replace function pg_temp.expect_one(p_def text, p_anchor text, p_what text)
returns void language plpgsql as $$
declare v_count int := 0; v_pos int := 1; v_at int;
begin
  loop
    v_at := position(p_anchor in substr(p_def, v_pos));
    exit when v_at = 0;
    v_count := v_count + 1;
    v_pos := v_pos + v_at + length(p_anchor) - 1;
  end loop;
  if v_count <> 1 then
    raise exception '% : the anchor %L appears % times, and a rewrite needs exactly one.', p_what, p_anchor, v_count;
  end if;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
  where proname = 'save_tournament' and pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception 'save_tournament is missing.';
  end if;

  if position('p_ends_at' in v_def) = 0 then
    -- The new parameter goes LAST and carries a default, so every existing positional call is
    -- unaffected.
    perform pg_temp.expect_one(v_def, 'p_swiss_rounds integer DEFAULT NULL::integer)', 'save_tournament signature');
    v_def := replace(v_def, 'p_swiss_rounds integer DEFAULT NULL::integer)',
                            'p_swiss_rounds integer DEFAULT NULL::integer, p_ends_at time without time zone DEFAULT NULL::time without time zone)');

    -- The INSERT's column list, then its values list, each anchored on the neighbours that make the
    -- fragment unique.
    perform pg_temp.expect_one(v_def, 'format, kickoff_time, visibility,', 'save_tournament insert columns');
    v_def := replace(v_def, 'format, kickoff_time, visibility,', 'format, kickoff_time, ends_at, visibility,');

    perform pg_temp.expect_one(v_def, 'v_format, p_kickoff_time,', 'save_tournament insert values');
    v_def := replace(v_def, 'v_format, p_kickoff_time,', 'v_format, p_kickoff_time, p_ends_at,');

    -- The UPDATE. `coalesce(p_ends_at, ends_at)` deliberately: saving a tournament without supplying
    -- an end time leaves the one already recorded alone, exactly as the kick-off above does.
    perform pg_temp.expect_one(v_def, 'kickoff_time = coalesce(p_kickoff_time, kickoff_time),', 'save_tournament update');
    v_def := replace(v_def, 'kickoff_time = coalesce(p_kickoff_time, kickoff_time),',
                            'kickoff_time = coalesce(p_kickoff_time, kickoff_time),' || chr(10) ||
                            '        ends_at = coalesce(p_ends_at, ends_at),');

    execute v_def;
  end if;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
  where proname = 'create_tournament_with_teams' and pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception 'create_tournament_with_teams is missing.';
  end if;

  if position('p_ends_at' in v_def) = 0 then
    perform pg_temp.expect_one(v_def, 'p_cover_stock_key text DEFAULT NULL::text)', 'create_tournament_with_teams signature');
    v_def := replace(v_def, 'p_cover_stock_key text DEFAULT NULL::text)',
                            'p_cover_stock_key text DEFAULT NULL::text, p_ends_at time without time zone DEFAULT NULL::time without time zone)');

    perform pg_temp.expect_one(v_def, 'ends_on, kickoff_time, rugby_code,', 'create_tournament_with_teams insert columns');
    v_def := replace(v_def, 'ends_on, kickoff_time, rugby_code,', 'ends_on, kickoff_time, ends_at, rugby_code,');

    perform pg_temp.expect_one(v_def, 'p_starts_on), p_kickoff_time, v_code,', 'create_tournament_with_teams insert values');
    v_def := replace(v_def, 'p_starts_on), p_kickoff_time, v_code,', 'p_starts_on), p_kickoff_time, p_ends_at, v_code,');

    execute v_def;
  end if;
end $$;

-- `create or replace function` with a new trailing parameter ADDS an overload rather than replacing
-- one, and because both carry defaults every existing positional call then fails with
-- "function ... is not unique". Drop the previous signatures explicitly.
drop function if exists public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text, integer);
drop function if exists public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer, text);

do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc where proname = 'save_tournament' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then raise exception 'save_tournament has % signatures; exactly one is required.', v_n; end if;
  select count(*) into v_n from pg_proc where proname = 'create_tournament_with_teams' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then raise exception 'create_tournament_with_teams has % signatures; exactly one is required.', v_n; end if;

  -- The rewrite landed where it was meant to, not merely somewhere.
  if (select pg_get_functiondef(oid) from pg_proc where proname = 'save_tournament' and pronamespace = 'public'::regnamespace)
     not like '%ends_at = coalesce(p_ends_at, ends_at)%' then
    raise exception 'save_tournament does not write ends_at on update.';
  end if;
end $$;

-- ---- the grants, which a DROP takes with it --------------------------------------------------------
--
-- `drop function` removes its privileges too, and `create or replace` on a NEW signature does not
-- inherit the old one's. Without this, every caller gets "permission denied for function
-- save_tournament" -- which is how this was found: the Tournament Centre suite went from 34 passes to
-- one error, with nothing wrong with the function itself.

revoke all on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text, integer, time without time zone) from public, anon;
grant execute on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text, integer, time without time zone) to authenticated;
grant execute on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text, integer, time without time zone) to service_role;

revoke all on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer, text, time without time zone) from public, anon;
grant execute on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer, text, time without time zone) to authenticated;
grant execute on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer, text, time without time zone) to service_role;

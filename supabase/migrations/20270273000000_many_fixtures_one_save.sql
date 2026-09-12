-- =====================================================================
-- MANY FIXTURES, ONE SAVE
--
-- Every field a fixture secretary edits already has a canonical writer:
-- update_fixture_kickoff, update_fixture_meet_time, update_fixture_venue,
-- update_fixture_pitch, update_fixture_competition. Each carries its own
-- authority check, its own refusals (a cancelled fixture's kick-off cannot
-- move), the shared-capacity trigger that stops a team playing twice in a
-- day, and audit through audit_row_change.
--
-- So the bulk path does NOT reimplement any of that. It ORCHESTRATES those
-- functions. Two consequences are deliberate:
--
--   SECURITY INVOKER. This function must never be `security definer`:
--   auth.uid() has to stay the real caller so each inner writer's own
--   authority check still means something. A definer wrapper here would
--   silently become the privileged bypass this design exists to avoid.
--
--   ONE EXCEPTION BLOCK PER FIXTURE. Rows are independent -- a secretary
--   moving twelve kick-offs does not want eleven good changes thrown away
--   because the twelfth clashes. Each fixture gets its own subtransaction,
--   so a refusal is reported against that fixture and the rest still save.
--   The caller is told exactly which failed and why, and nothing is ever
--   half-written inside a single fixture.
--
-- THE CAPABILITY IS CHECKED PER FIXTURE, NOT ONCE. A person may hold
-- fixture.bulk_edit for one team and not another, so the scope question is
-- asked of every fixture in the set -- club scope, or team scope for that
-- fixture's own owning team. Site Admin passes on its own authority.
-- =====================================================================

create or replace function public.bulk_update_fixtures(p_changes jsonb)
returns table (fixture_id uuid, ok boolean, error_message text)
language plpgsql
-- Deliberately INVOKER. See the header.
security invoker
set search_path = public, internal, pg_temp
as $$
declare
  v_change jsonb;
  v_id uuid;
  v_club uuid;
  v_team uuid;
  v_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Expected an array of fixture changes.';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes)
  loop
    v_id := (v_change ->> 'fixture_id')::uuid;
    fixture_id := v_id;
    ok := false;
    error_message := null;

    begin
      select f.owning_team_id into v_team from public.fixtures f where f.id = v_id;
      if v_team is null then
        raise exception 'Fixture not found.';
      end if;

      v_club := internal.caller_fixture_club_id(v_id);

      -- Bulk editing is its own grant, asked per fixture so a team-scoped
      -- holder cannot reach a team they do not run.
      v_allowed := internal.is_site_admin()
        or (v_club is not null and internal.has_capability('fixture.bulk_edit', 'club', v_club, null))
        or internal.has_capability('fixture.bulk_edit', 'team', v_club, v_team);

      if not v_allowed then
        raise exception 'You do not have permission to bulk edit this fixture.' using errcode = '42501';
      end if;

      -- Each field goes through its own canonical writer, so every rule
      -- that applies to editing one fixture applies here unchanged.
      if v_change ? 'kickoff_date' then
        perform public.update_fixture_kickoff(
          v_id,
          (v_change ->> 'kickoff_date')::date,
          nullif(v_change ->> 'kickoff_time', '')::time
        );
      end if;

      if v_change ? 'meet_time' then
        perform public.update_fixture_meet_time(v_id, nullif(v_change ->> 'meet_time', '')::time);
      end if;

      if v_change ? 'venue_id' then
        perform public.update_fixture_venue(v_id, nullif(v_change ->> 'venue_id', '')::uuid);
      end if;

      if v_change ? 'pitch_id' then
        perform public.update_fixture_pitch(v_id, nullif(v_change ->> 'pitch_id', '')::uuid, null);
      end if;

      if v_change ? 'competition_edition_id' then
        perform public.update_fixture_competition(
          v_id,
          nullif(v_change ->> 'competition_edition_id', '')::uuid
        );
      end if;

      ok := true;
    exception
      when others then
        -- The inner writer's own sentence, which is written for a person.
        ok := false;
        error_message := sqlerrm;
    end;

    return next;
  end loop;
end;
$$;

comment on function public.bulk_update_fixtures(jsonb) is
  'Applies a set of fixture edits in one call by delegating each field to its existing canonical writer, so authority, validation, conflict rules and audit are exactly those of a single-fixture edit. SECURITY INVOKER on purpose. Returns one row per fixture with its own success or refusal, because a clash on one fixture must not discard the others.';

revoke all on function public.bulk_update_fixtures(jsonb) from public, anon;
grant execute on function public.bulk_update_fixtures(jsonb) to authenticated;

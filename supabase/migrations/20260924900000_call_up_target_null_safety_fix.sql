-- Bug found live-testing fixture_player_call_up (20260924830000): the
-- "target_team_id must be one of the teams actually playing this
-- fixture" check used `(select opponent_team_id ...) = new.target_
-- team_id`, which is NULL, not false, whenever the fixture has no
-- opponent_team_id set (an ordinary case -- many fixtures record the
-- opponent only as raw_opposition_text). `not (false or null)`
-- evaluates to `not null` = NULL, and a NULL condition in a PL/pgSQL
-- IF is treated as false, so the whole guard silently never fired for
-- any such fixture -- a call-up could target a team that had nothing
-- to do with the match at all. Fixed by wrapping both branches in
-- coalesce(..., false) so an unset opponent_team_id can only ever make
-- the check MORE strict, never bypass it.
create or replace function internal.validate_player_call_up()
returns trigger
language plpgsql
as $$
declare
  v_source public.teams;
  v_target public.teams;
  v_effective_ids uuid[];
  v_source_age integer;
  v_target_age integer;
begin
  select * into v_source from public.teams where id = new.source_team_id;
  select * into v_target from public.teams where id = new.target_team_id;

  if v_source.club_id <> v_target.club_id then
    raise exception 'A player call-up can only move a player between two teams of the SAME club. A cross-club arrangement needs a Dispensation, not a call-up.' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.player_team_memberships
    where player_id = new.player_id and team_id = new.source_team_id and status = 'active' and ended_at is null
  ) then
    raise exception 'This player is not an active member of the stated source team -- source_team_id cannot be forged.' using errcode = '23514';
  end if;

  v_effective_ids := public.get_effective_fixture_team_ids(new.fixture_id);
  if not (
    coalesce(new.target_team_id = any(v_effective_ids), false)
    or coalesce((select opponent_team_id from public.fixtures where id = new.fixture_id) = new.target_team_id, false)
  ) then
    raise exception 'target_team_id is not one of the teams actually playing this fixture.' using errcode = '23514';
  end if;

  v_source_age := substring(v_source.age_group from '^U(\d+)')::integer;
  v_target_age := substring(v_target.age_group from '^U(\d+)')::integer;
  if v_source_age is not null and v_target_age is not null and v_target_age < v_source_age then
    raise exception 'A call-up must move a player UP an age grade (from % to %), never down.', v_source.age_group, v_target.age_group using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

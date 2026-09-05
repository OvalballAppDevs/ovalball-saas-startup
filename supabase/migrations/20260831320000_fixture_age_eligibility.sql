-- Age-grade fixture eligibility, enforced at the real boundary (a trigger
-- on public.fixtures itself, not just UI filtering or an app-layer check
-- that a direct REST/RPC call could bypass) -- the same reasoning this
-- project already applies everywhere else ("RLS/triggers are the real
-- boundary"). One centralized rule (internal.teams_can_play_fixture),
-- reused by the interactive opponent resolver's matching query, the CSV
-- import validator, and this trigger, rather than three independent
-- reimplementations that could drift apart.
--
-- Rules (youth, boys/mixed): U9-U16 are strict same-age-group only. U6/U7/U8
-- form one compatible tag-rugby band. Girls youth teams (gender='womens')
-- skip the strict age match entirely -- age-grade structures vary too much
-- by club/competition to encode a single strict rule, per the brief; the
-- real team age stays visible in the UI regardless, never relabelled.
-- Senior teams need matching rugby_code+category+gender, but never
-- team_number -- Men's 2nd vs Men's 3rd, Women's 1st vs Women's 2nd are
-- both fine; Men's is never auto-matched against Women's. An unresolved opponent (no team row at all -- free text or a
-- directory-only club) has nothing to check here; that path's own
-- "needs review" state already covers it, this rule only applies once two
-- real canonical teams are being matched against each other.

create function internal.age_fixture_band(p_age_group text)
returns text
language sql
immutable
as $$
  select case when p_age_group in ('U6', 'U7', 'U8') then 'tag_u6_u8' else p_age_group end;
$$;

comment on function internal.age_fixture_band(text) is
  'U6/U7/U8 collapse into one compatible tag-rugby band; every other age_group (including U9-U16) is its own strict band. Never changes teams.age_group itself -- fixture-eligibility grouping only.';

create function internal.teams_can_play_fixture(p_team_a uuid, p_team_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a record;
  b record;
begin
  select rugby_code, category, age_group, gender into a from public.teams where id = p_team_a;
  select rugby_code, category, age_group, gender into b from public.teams where id = p_team_b;
  if a.rugby_code is null or b.rugby_code is null then
    return true; -- one side unresolved (no team row) -- nothing to check here
  end if;
  if a.rugby_code <> b.rugby_code or a.category <> b.category then
    return false;
  end if;
  if a.category <> 'youth' then
    -- Senior: gender still has to match (Men's plays Men's, Women's plays
    -- Women's), but team_number never blocks a match (Men's 2nd vs Men's
    -- 3rd, Women's 1st vs Women's 2nd are both fine). A team with no
    -- gender set is treated as compatible with anything.
    return a.gender is null or b.gender is null or a.gender = b.gender;
  end if;
  if a.gender = 'womens' and b.gender = 'womens' then
    return true; -- girls youth rugby: deliberately flexible on age, per the brief
  end if;
  return internal.age_fixture_band(a.age_group) is not null and internal.age_fixture_band(a.age_group) = internal.age_fixture_band(b.age_group);
end;
$$;

comment on function internal.teams_can_play_fixture(uuid, uuid) is
  'The single source of truth for whether two canonical teams may fixture each other -- reused by findMatchingOpponentTeams (app), the CSV import validator (app), and enforce_fixture_age_eligibility (this trigger, the real unbypassable boundary). See migration header for the exact rule set.';

grant execute on function internal.teams_can_play_fixture(uuid, uuid) to authenticated;

create function internal.enforce_fixture_age_eligibility()
returns trigger
language plpgsql
as $$
begin
  if new.opponent_team_id is not null and not internal.teams_can_play_fixture(new.owning_team_id, new.opponent_team_id) then
    raise exception 'Age-grade mismatch: these teams are not eligible to play each other.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_fixture_age_eligibility
  before insert or update on public.fixtures
  for each row execute function internal.enforce_fixture_age_eligibility();

comment on trigger enforce_fixture_age_eligibility on public.fixtures is
  'Blocks saving a fixture between two canonical teams that fail internal.teams_can_play_fixture -- fires on every insert/update, so no admin action, CSV publish, or direct table write can bypass it. Deliberately no override path (the brief: no casual admin override for strict U9-U16 mismatches).';

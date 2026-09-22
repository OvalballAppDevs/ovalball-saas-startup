-- TEAM FIXTURE OPERATIONS -- AN INCOMPATIBLE FIXTURE REQUEST IS REFUSED WHEN IT IS MADE.
--
-- WHAT WAS ALREADY TRUE. `internal.teams_can_play_fixture` is the canonical compatibility rule -- same
-- rugby code, same category, senior sides matched on gender, youth sides matched on an EXACT
-- `internal.age_fixture_band` -- and it was already enforced where it matters most: a trigger on
-- public.fixtures, and inside public.accept_fixture_request. An under-12 side could never end up with
-- a fixture against a senior XV.
--
-- WHAT WAS NOT. Nothing stopped the REQUEST being sent. `fixture_requests` enforced capability on
-- insert (you may only request for a team you hold fixture.request.create on) but not eligibility, so
-- a request that could never be accepted could still be created -- and it arrives as a notification
-- that somebody has to read and answer before discovering it was never legal. The owner's rule is
-- that a team may request fixtures only against teams of its appropriate age group, and "the server
-- must independently reject" it.
--
-- THE SAME RULE, NOT A SECOND ONE. This calls `internal.teams_can_play_fixture`. It does not restate
-- the regulation, does not match on names, and does not introduce a rule of its own -- the age grades
-- come from the canonical team record, as they already did.
--
-- AND IT ONLY JUDGES WHAT IT CAN SEE. A request may legitimately name no target team at all: it can
-- be addressed to a scheduling group, or to a structured directory identity for a club whose team is
-- not on Ovalball yet. Those are resolved later, and `accept_fixture_request` applies the same
-- predicate at that point. This checks the case it can decide and stays out of the ones it cannot,
-- rather than failing closed on a request that is perfectly legal.

begin;

create or replace function internal.enforce_fixture_request_age_eligibility()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.requesting_team_id is null or new.target_team_id is null then
    return new;
  end if;
  if not internal.teams_can_play_fixture(new.requesting_team_id, new.target_team_id) then
    raise exception 'Those teams are not age-eligible to play each other.'
      using errcode = '23514',
            hint = 'A team may only request fixtures against teams in the same age band, code and category.';
  end if;
  return new;
end $$;

comment on function internal.enforce_fixture_request_age_eligibility() is
  'Refuses a fixture request between teams that could never legally play. Delegates the whole judgement '
  'to internal.teams_can_play_fixture -- the one compatibility rule -- and skips requests whose target '
  'team is not yet known, which accept_fixture_request checks instead.';

drop trigger if exists fixture_requests_age_eligibility on public.fixture_requests;
create trigger fixture_requests_age_eligibility
  before insert or update of requesting_team_id, target_team_id on public.fixture_requests
  for each row execute function internal.enforce_fixture_request_age_eligibility();

-- -----------------------------------------------------------------------------------------------------
-- SELF-CHECK.
-- -----------------------------------------------------------------------------------------------------
do $guard$
declare v_def text;
begin
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.fixture_requests'::regclass
      and tgname = 'fixture_requests_age_eligibility' and not tgisinternal
  ) then
    raise exception 'the fixture request eligibility trigger is not attached';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'enforce_fixture_request_age_eligibility';
  v_def := regexp_replace(v_def, '--[^\n]*', '', 'g');

  -- THE RULE IS DELEGATED, NOT COPIED. A second implementation of age eligibility is the failure this
  -- guard exists to prevent: two rules drift, and the one nobody is looking at becomes wrong.
  if v_def !~ 'teams_can_play_fixture' then
    raise exception 'the request guard does not use the canonical compatibility rule';
  end if;
  if v_def ~ 'age_group\s*=|age_fixture_band\(' then
    raise exception 'the request guard restates age eligibility instead of delegating it';
  end if;

  -- And the fixture-level trigger it complements is still there.
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
     where t.tgrelid = 'public.fixtures'::regclass and n.nspname = 'internal'
       and p.proname = 'enforce_fixture_age_eligibility' and not t.tgisinternal
  ) then
    raise exception 'the fixture-level age eligibility trigger has gone';
  end if;

  raise notice 'Team fixture operations: an ineligible fixture request is now refused when it is made.';
end $guard$;

commit;

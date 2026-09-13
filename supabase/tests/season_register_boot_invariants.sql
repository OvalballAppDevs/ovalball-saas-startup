-- A season comes from the register, or it does not come at all.
--
-- THE RULE
--
-- Every season boundary in Ovalball derives from the canonical Seasons
-- register. There is one season calendar and no second answer. When a season
-- that something needs is genuinely absent, the correct behaviour is to say
-- so -- NEEDS_ATTENTION -- never to compute a fallback, assume a month
-- boundary, or manufacture a row so a check can go green.
--
-- WHY THIS TEST EXISTS
--
-- Three migrations carried self-assertions that asked the resolver where a
-- player lands in a real season. On a database whose register had not been
-- populated yet there was no such season, the resolver correctly answered
-- NEEDS_ATTENTION, and each migration read that correct answer as a failure
-- and stopped the install. The migrations now stand aside where the register
-- is empty -- which moves the burden of proof here, and makes this file the
-- thing that stops "stand aside" from quietly becoming "never checked".
--
-- So both states are proved, in one run, on whatever database it is given:
--
--   CASE 1  register empty  -> nothing is invented, nothing raises merely
--                              because the register is empty, and anything
--                              needing a season reports NEEDS_ATTENTION.
--   CASE 2  season present  -> the real assertion executes and still bites;
--                              correct canonical dates are used, and wrong
--                              behaviour still fails.
--
-- Case 1 is reproduced by handing the resolver no season -- which is exactly
-- what every caller is handed when the register cannot answer -- rather than
-- by emptying the table. The reasoning is at the case itself; the short
-- version is that a test file which truncates a real table is one stray run
-- outside its transaction away from destroying a developer's database, and
-- the genuinely-empty-table case is proved for free by the unattended clean
-- boot instead.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_alloc text;
  v_label text;
  v_season uuid;
  v_count int;
  v_before int;
  v_raised text;
  v_year int;
  v_early uuid;
  v_late uuid;
  v_label2 text;
begin
  select count(*) into v_before from public.seasons;
  raise notice 'INFO: the register held % season(s) when this test started', v_before;

  -- =================================================================
  -- CASE 1 -- THE REGISTER HAS NO SEASON TO GIVE
  --
  -- Reproduced by asking the resolver the question a caller asks when the
  -- register is empty -- "resolve this player, and here is no season" -- and
  -- NOT by emptying the table.
  --
  -- Emptying it was the obvious first instinct and it is the wrong design.
  -- Seasons sit at the root of a foreign-key tree several levels deep, so
  -- clearing it means TRUNCATE ... CASCADE, and a file that truncates a real
  -- table is one stray run outside its transaction away from destroying a
  -- developer's database. The transaction is not worth relying on for that.
  --
  -- Passing no season is the same condition from the only place it matters:
  -- what every caller gets handed when the register cannot answer. The
  -- genuinely-empty-table case is proved where it is real and free -- the
  -- unattended clean boot, which runs all 421 migrations against a database
  -- holding zero seasons and must still finish with zero.
  -- =================================================================
  select count(*) into v_count from public.seasons;
  if v_count = v_before then
    raise notice 'PASS 1: the register is observed without being altered to observe it';
  else
    raise notice 'FAIL 1: the register changed before the test began (% then %)', v_before, v_count;
  end if;

  -- 3. The resolver reports rather than guesses. With no season to resolve
  -- against it must answer NEEDS_ATTENTION -- not a placement, not a default
  -- age grade, and not an exception.
  begin
    select allocation_status, canonical_label into v_alloc, v_label
    from public.resolve_normal_operational_identity(
      'union', null, (current_date - interval '10 years')::date, 'male');
    if v_alloc = 'NEEDS_ATTENTION' then
      raise notice 'PASS 3: with no season registered the resolver reports NEEDS_ATTENTION';
    else
      raise notice 'FAIL 3: the resolver answered % with no season registered', v_alloc;
    end if;
  exception when others then
    raise notice 'FAIL 3: the resolver raised on an empty register (%)', sqlerrm;
  end;

  -- 4. And it does not fail closed by raising. An empty register is a state
  -- the product must survive, because it is the state of every new database
  -- before Site Admin has entered a season.
  begin
    perform public.resolve_normal_operational_identity(
      'union', null, (current_date - interval '18 years 2 months')::date, 'male');
    raise notice 'PASS 4: an absent season is reported, not thrown';
  exception when others then
    raise notice 'FAIL 4: an absent season raised an exception (%)', sqlerrm;
  end;

  -- 5. The age-grade catalogue is governing-body regulation, not operational
  -- season data, so it must still answer with no season available. This is the
  -- line the migrations' unconditional assertions sit on.
  if internal.highest_youth_age_offered('union', 'boys') = 18
     and internal.highest_youth_age_offered('league', 'boys') = 19 then
    raise notice 'PASS 5: governing-body age grades answer without a season';
  else
    raise notice 'FAIL 5: the age-grade catalogue depends on the season register';
  end if;

  -- 5b. NOTHING IS INVENTED. The assertion this whole file exists for: asking
  -- the resolver again and again with no season must never cause a season to
  -- come into existence. A fallback written anywhere in this path -- a
  -- computed year, a hardcoded 1 September, a helpfully seeded row -- shows up
  -- here as the count moving.
  select count(*) into v_count from public.seasons;
  perform public.resolve_normal_operational_identity('union', null, (current_date - interval '7 years')::date, 'male');
  perform public.resolve_normal_operational_identity('union', null, (current_date - interval '13 years')::date, 'female');
  perform public.resolve_normal_operational_identity('league', null, (current_date - interval '16 years')::date, 'male');
  perform public.resolve_normal_operational_identity('league', null, (current_date - interval '25 years')::date, null);
  if (select count(*) from public.seasons) = v_count then
    raise notice 'PASS 5b: resolving without a season invented no season (still % row(s))', v_count;
  else
    raise notice 'FAIL 5b: a season was manufactured -- % became %', v_count, (select count(*) from public.seasons);
  end if;

  -- =================================================================
  -- CASE 2 -- A CANONICAL SEASON IS PRESENT
  --
  -- The same assertions the three migrations make, executed here so they are
  -- checked on every run rather than only at install time.
  -- =================================================================
  -- Use the register's own canonical season where there is one, so these run
  -- against real data on a populated database. Only where the register is
  -- empty does this test supply its own, marked is_regression_fixture so it
  -- can never be mistaken for a canonical answer -- and the year is taken from
  -- the first one actually free, because (rugby_code, season_year_start) is
  -- unique and a hardcoded year collides the moment a real season uses it.
  select id into v_season
  from public.seasons
  where rugby_code = 'union' and not is_regression_fixture
  order by starts_on desc limit 1;

  if v_season is null then
    select coalesce(max(season_year_start), extract(year from current_date)::int) + 1
      into v_year from public.seasons where rugby_code = 'union';
    insert into public.seasons
      (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref,
       is_regression_fixture, pre_season_starts_on)
    values
      ('Boot Invariant Season', (current_date - interval '1 month')::date,
       (current_date + interval '9 months')::date, true, 'union',
       v_year, 'boot-inv', true, (current_date - interval '2 months')::date)
    returning id into v_season;
    raise notice 'INFO: the register was empty, so this test registered its own fixture season';
  end if;

  if v_season is not null then
    raise notice 'PASS 6: a season is available to resolve against';
  else
    raise notice 'FAIL 6: no season was available';
  end if;

  -- 7. The migration assertion from 20261208000000: a Union player past U18
  -- lands in club holding, not in an adult team.
  select allocation_status into v_alloc
  from public.resolve_normal_operational_identity(
    'union', v_season, (current_date - interval '18 years 2 months')::date, 'male');
  if v_alloc = 'CLUB_HOLDING' then
    raise notice 'PASS 7: past U18 a Union player resolves to CLUB_HOLDING';
  else
    raise notice 'FAIL 7: past U18 a Union player resolved to %', v_alloc;
  end if;

  -- 8. And past every youth grade, the same.
  select allocation_status into v_alloc
  from public.resolve_normal_operational_identity(
    'union', v_season, (current_date - interval '21 years')::date, 'male');
  if v_alloc = 'CLUB_HOLDING' then
    raise notice 'PASS 8: an adult past every youth grade resolves to CLUB_HOLDING';
  else
    raise notice 'FAIL 8: an adult past every youth grade resolved to %', v_alloc;
  end if;

  -- 9. The migration assertion from 20261215000000: inside the Mixed band a
  -- missing pathway is fine, because mini-rugby is mixed.
  select allocation_status into v_alloc
  from public.resolve_normal_operational_identity(
    'union', v_season, (current_date - interval '10 years')::date, null);
  if v_alloc = 'NORMAL_PLACEMENT' then
    raise notice 'PASS 9: a mini-rugby age places without a recorded pathway';
  else
    raise notice 'FAIL 9: a mini-rugby age resolved to % without a pathway', v_alloc;
  end if;

  -- 10. Past the Mixed band it must fail CLOSED rather than pick one.
  select allocation_status into v_alloc
  from public.resolve_normal_operational_identity(
    'union', v_season, (current_date - interval '13 years')::date, null);
  if v_alloc = 'CLASSIFICATION_REQUIRED' then
    raise notice 'PASS 10: past the Mixed band a missing pathway fails closed';
  else
    raise notice 'FAIL 10: past the Mixed band a missing pathway resolved to %', v_alloc;
  end if;

  -- 11. THE CHECK STILL BITES. A test that only ever passes proves nothing,
  -- so ask the resolver something that must NOT come back as a placement --
  -- an age far below the youngest supported grade.
  select allocation_status into v_alloc
  from public.resolve_normal_operational_identity(
    'union', v_season, (current_date - interval '2 years')::date, 'male');
  if v_alloc <> 'NORMAL_PLACEMENT' then
    raise notice 'PASS 11: an unsupported age is refused a normal placement (%)', v_alloc;
  else
    raise notice 'FAIL 11: a 2-year-old was given a normal placement';
  end if;

  -- 12. Dates come from the registered row, not from a computed cutoff.
  --
  -- Two seasons, identical in every way except when they run, are asked about
  -- the same child. A resolver reading the register answers from each row's
  -- own dates; one reading a hardcoded 1 September or an extract(year from
  -- now()) cutoff cannot tell them apart and answers identically.
  --
  -- Done on this test's OWN fixture rows -- a canonical season is never
  -- edited, even inside a transaction that will roll back.
  select coalesce(max(season_year_start), extract(year from current_date)::int) + 1
    into v_year from public.seasons where rugby_code = 'union';

  insert into public.seasons
    (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref,
     is_regression_fixture, pre_season_starts_on)
  values
    ('Boot Invariant Early', (current_date - interval '10 months')::date,
     (current_date - interval '1 month')::date, false, 'union',
     v_year, 'boot-inv-early', true, (current_date - interval '11 months')::date)
  returning id into v_early;

  insert into public.seasons
    (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref,
     is_regression_fixture, pre_season_starts_on)
  values
    ('Boot Invariant Late', (current_date + interval '8 years')::date,
     (current_date + interval '9 years')::date, false, 'union',
     v_year + 1, 'boot-inv-late', true, (current_date + interval '7 years 11 months')::date)
  returning id into v_late;

  select canonical_label into v_label
  from public.resolve_normal_operational_identity(
    'union', v_early, (current_date - interval '10 years')::date, 'male');
  select canonical_label into v_label2
  from public.resolve_normal_operational_identity(
    'union', v_late, (current_date - interval '10 years')::date, 'male');

  if v_label is distinct from v_label2 then
    raise notice 'PASS 12: the answer follows the registered dates (% vs %)',
      coalesce(v_label, '(none)'), coalesce(v_label2, '(none)');
  else
    raise notice 'FAIL 12: two seasons eight years apart gave the same answer (%) -- the season register is not deciding this',
      coalesce(v_label, '(none)');
  end if;
end $$;

rollback;

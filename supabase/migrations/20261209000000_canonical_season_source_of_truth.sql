-- One authoritative season calendar.
--
-- PRODUCT RULE: Site Admin -> Seasons is the ONLY authoritative source for
-- season dates. Every operational boundary -- season start, season end,
-- pre-season start, the handover boundary, which season a fixture belongs to,
-- what "current season" means -- derives from the canonical public.seasons
-- record. Text labels are presentation only.
--
-- WHAT THE AUDIT FOUND
--
-- The operational side is already clean. Every derivation reads
-- public.seasons:
--
--   internal.resolve_season_for_date      -- which season contains a date,
--                                            from starts_on / ends_on /
--                                            pre_season_starts_on
--   internal.regulatory_school_year_start -- the school year a season names,
--                                            from season_year_start
--   public.resolve_player_regulatory_age  -- built on the above
--   internal.compute_season_identity      -- derives season_year_start, name
--                                            and season_ref ON the canonical
--                                            row; labels, not authority
--   capture_fixture_team_snapshot         -- fixtures.season_id, assigned by
--                                            resolve_season_for_date
--   process_due_season_transitions        -- the handover boundary, taken
--                                            from the target season's
--                                            pre_season_starts_on with no
--                                            hardcoded fallback: a missing
--                                            date produces NEEDS_ATTENTION
--   public.get_team_identity_for_season   -- what a team was called (or will
--                                            be called) in a season, keyed on
--                                            season_id
--
-- ONE COMPETING CALENDAR, REMOVED
--
-- internal.regulatory_season_of(date) computed a season label straight from a
-- date using a hardcoded 1 August boundary, reading nothing:
--
--   when extract(month from p_date) >= 8
--     then year || '/' || right((year + 1)::text, 2)
--
-- It ignored the canonical season's actual starts_on, ignored
-- pre_season_starts_on entirely, and ignored the code distinction -- League
-- seasons are single-year ("2026"), not "2026/27". It had been superseded by
-- the code-aware two-argument overload and had NO callers left anywhere: not
-- in a function, a view, a constraint, or the application.
--
-- A zero-caller function is not harmless when it is a second answer to a
-- question the product must answer one way. It sits in the schema looking
-- authoritative, and the next person needing "which season is this date in"
-- may well find it before they find resolve_season_for_date. It is dropped.
--
-- WHAT LEGITIMATELY IS NOT public.seasons
--
-- Two things derive from governing regulation rather than from Ovalball's
-- operational calendar, and must keep doing so:
--
--   * The DOB cutoff in the age resolver -- 1 September to 31 August school
--     years -- is RFU/RFL rule, not an Ovalball setting. It must not become
--     editable in Site Admin.
--   * internal.regulatory_season_of(date, rugby_code) labels which governing
--     -body SEASON a published regulation belongs to, for the Rugby Hub. Its
--     1 August boundary is the RFU's regulatory year. It answers a question
--     about documents, never about fixtures, handover or team identity.

-- ============================================================
-- Remove the competing calendar.
-- ============================================================

drop function if exists internal.regulatory_season_of(date);

-- ============================================================
-- Prove there is only one operational answer.
-- ============================================================

do $$
declare v_bad text; v_n int;
begin
  -- The code-blind season calendar must be gone.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'regulatory_season_of'
      and pg_get_function_arguments(p.oid) = 'p_date date'
  ) then
    raise exception 'The code-blind regulatory_season_of(date) still exists.';
  end if;

  -- The code-aware regulatory one stays: it is about documents.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'regulatory_season_of'
      and pg_get_function_arguments(p.oid) like '%rugby_code%'
  ) then
    raise exception 'The code-aware regulatory document-season helper was removed by mistake.';
  end if;

  -- The two resolvers that answer "which season / which school year" from
  -- first principles must read the canonical table itself.
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind = 'f'
    and p.proname in ('resolve_season_for_date', 'regulatory_school_year_start')
    and pg_get_functiondef(p.oid) !~ 'public\.seasons';
  if v_bad is not null then
    raise exception 'These season resolvers do not read public.seasons: %', v_bad;
  end if;

  -- Everything downstream is canonical by construction rather than by reading
  -- the table again: the age resolver delegates to regulatory_school_year_start,
  -- and team_identity_for_season is keyed on a canonical season_id supplied by
  -- its caller. Assert that, rather than demanding a literal table reference
  -- they have no reason to contain.
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'resolve_player_regulatory_age')
     !~ 'regulatory_school_year_start' then
    raise exception 'The age resolver no longer derives its school year from the canonical season.';
  end if;

  if (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_team_identity_for_season')
     !~ 'season_id' then
    raise exception 'get_team_identity_for_season is no longer keyed on a canonical season id.';
  end if;

  -- The handover boundary must not carry a hardcoded date.
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'process_due_season_transitions')
     !~ 'pre_season_starts_on' then
    raise exception 'The automatic handover no longer derives its boundary from the canonical season.';
  end if;

  -- Nothing may hardcode a season boundary as a literal date.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind = 'f'
    and p.proname ~* 'season|rollover|handover|fixture'
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ 'date ''\d{4}-(09-01|08-31)''';
  if v_n > 0 then
    raise exception '% operational function(s) hardcode a season boundary date.', v_n;
  end if;
end $$;

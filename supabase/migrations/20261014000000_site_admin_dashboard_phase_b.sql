-- Site Admin Dashboard, Phase B -- rugby activity, growth and adoption.
--
-- Phase A established three read models grouped by refresh class. Phase B
-- EXTENDS that shape rather than adding a function per chart:
--
--   * site_admin_dashboard_operations()      -- re-declared, gains the
--                                               booked-fixture counters
--   * site_admin_dashboard_fixtures_today()  -- the Playing Today list
--                                               (a row set; it cannot share
--                                               the scalar row's shape)
--   * site_admin_dashboard_trends()          -- ONE long-cache call carrying
--                                               every chart's points
--
-- Three additions, not eight. The browser receives chart-ready aggregates
-- and never a row to count for itself.
--
-- TIME. Everything here buckets in Europe/London, which is Main's only
-- timezone convention (the clubs.timezone default) and the right one for a
-- UK rugby product. A "week" is the Postgres date_trunc week: Monday to
-- Sunday. Both are stated so a boundary is never a matter of opinion.
--
-- TWO CLOCKS, NEVER MIXED. A fixture has a creation time and a kickoff
-- date, and they answer different questions:
--
--   booked_*        -> fixtures.created_at   ("when was this arranged")
--   playing/today   -> fixtures.kickoff_date ("when is it played")
--
-- The Stage 1 audit found this conflation is the easiest way to make a
-- fixture dashboard quietly wrong, so the two never share a metric or an
-- unlabelled chart series.
--
-- ONE PHYSICAL FIXTURE. Every fixture read goes through
-- admin_fixture_overview with is_primary_mirror, the established dedup
-- contract: a confirmed two-sided fixture is one row with one id, and
-- historical mirror pairs are not counted twice. conversation_id is not
-- fixture identity and is never used as one.

-- =====================================================================
-- 1. Operations -- re-declared with the booked-fixture counters
-- =====================================================================

-- Dropped first, deliberately: adding OUT parameters changes the return
-- type, which `create or replace` cannot do -- it either errors or, where
-- the argument list also differs, silently leaves a second function behind.
-- That is exactly the ambiguous-overload defect F0 shipped and Phase A had
-- to clean up (see 20261013000000). Drop, recreate, then assert there is
-- exactly one.
drop function if exists public.site_admin_dashboard_operations();

create or replace function public.site_admin_dashboard_operations()
returns table (
  fixtures_today int,
  fixtures_booked_this_week int,
  fixtures_booked_this_month int,
  fixtures_cancelled_this_month int,
  pending_club_claims int,
  pending_directory_requests int,
  stuck_fixture_requests int,
  disputed_results int,
  results_awaiting_confirmation int,
  open_support_tickets int,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_week_start timestamptz := date_trunc('week', now() at time zone 'Europe/London') at time zone 'Europe/London';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London';
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  return query
  select
    -- PLAYING today: kickoff date.
    (select count(*)::int from public.admin_fixture_overview f
      where f.kickoff_date = v_today
        and f.is_primary_mirror = true
        and f.status <> 'Cancelled'),

    -- BOOKED this week / month: creation time. Never kickoff.
    (select count(*)::int from public.admin_fixture_overview f
      where f.is_primary_mirror = true and f.created_at >= v_week_start),
    (select count(*)::int from public.admin_fixture_overview f
      where f.is_primary_mirror = true and f.created_at >= v_month_start),

    -- Cancellations attribute to when they were cancelled, not to kickoff:
    -- a match called off today is this month's cancellation even if it was
    -- due to be played next season.
    (select count(*)::int from public.fixtures fx
      where fx.status = 'Cancelled' and fx.cancelled_at >= v_month_start),

    (select count(*)::int from public.club_claims cc where cc.status = 'pending'),
    (select count(*)::int from public.directory_requests dr where dr.status = 'pending'),
    (select count(*)::int from public.fixture_requests fr
      where fr.status = 'sent' and fr.created_at < now() - interval '14 days'),
    (select count(*)::int from public.fixtures fx where fx.result_status = 'disputed'),
    (select count(*)::int from public.fixtures fx where fx.result_status = 'awaiting_confirmation'),
    (select count(*)::int from public.support_tickets st where st.status <> 'closed'),

    now();
end;
$$;

revoke execute on function public.site_admin_dashboard_operations() from public, anon, authenticated;
grant execute on function public.site_admin_dashboard_operations() to authenticated;

comment on function public.site_admin_dashboard_operations is
  'Site Admin dashboard: near-real-time operational signals. fixtures_today counts by KICKOFF date; fixtures_booked_* count by CREATION time -- the two are never interchangeable. Weeks are Monday-start, bucketed in Europe/London. Requires Site Admin.';

-- =====================================================================
-- 2. Playing today
-- =====================================================================

-- Ordering, stated once so it is not a matter of taste:
--   1. fixtures with a kickoff time, earliest first -- the next thing to
--      happen is the thing a Site Admin needs;
--   2. fixtures with no kickoff time recorded (TBD) last, because "some
--      time today" cannot be sequenced against "14:00";
--   3. id as the final key, so the list is deterministic and a refresh
--      never reshuffles two 14:00 fixtures.
--
-- Main tracks no live/in-progress match state, so none is invented: a
-- fixture is simply today's, in kickoff order. Completed fixtures keep
-- their place in the day rather than being hidden, because "what happened
-- today" is as operational as "what is coming".
--
-- Team and club identity come from admin_fixture_overview, which is the
-- season-aware canonical resolver -- never from a mutable current
-- display_name.
create or replace function public.site_admin_dashboard_fixtures_today(p_limit int default 5)
returns table (
  fixture_id uuid,
  kickoff_time time,
  home_club text,
  home_team text,
  away_club text,
  away_team text,
  competition text,
  venue text,
  rugby_code text,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  return query
  select
    f.id,
    f.kickoff_time,
    coalesce(f.home_club_name, 'To be confirmed'),
    coalesce(f.home_team_name, f.owning_team_name, 'Team'),
    coalesce(f.away_club_name, f.opponent_club_name, f.raw_opposition_text, 'To be confirmed'),
    coalesce(f.away_team_name, f.opponent_team_name, ''),
    f.competition_name,
    f.venue_name,
    f.rugby_code,
    f.status
  from public.admin_fixture_overview f
  where f.kickoff_date = v_today
    and f.is_primary_mirror = true
    and f.status <> 'Cancelled'
  order by (f.kickoff_time is null), f.kickoff_time asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 5), 50));
end;
$$;

revoke execute on function public.site_admin_dashboard_fixtures_today(int) from public, anon, authenticated;
grant execute on function public.site_admin_dashboard_fixtures_today(int) to authenticated;

comment on function public.site_admin_dashboard_fixtures_today is
  'Site Admin dashboard: physical fixtures playing today, deduped by is_primary_mirror, ordered by kickoff (TBD last) then id. Club and team identity come from the season-aware admin_fixture_overview, never from a current display name. No player data. Requires Site Admin.';

-- =====================================================================
-- 3. Trends -- one long-cache call for every Phase B chart
-- =====================================================================

-- Returns pre-bucketed points, not rows to be counted in a browser.
--
-- Growth is emitted at two resolutions in a single call -- 30 daily buckets
-- and 12 monthly buckets -- so the window selector switches between
-- already-aggregated series instead of issuing a request per window. Total
-- payload is a couple of hundred integers.
--
-- ALL-TIME is deliberately NOT offered: monthly buckets cover twelve
-- months, and an unbounded series would need buckets nobody has asked for.
-- Where the platform is younger than a year, the 12M view already IS all
-- time, and the UI says so rather than relabelling it.
--
-- Bulk-created records legitimately spike on their insertion date. Nothing
-- here smooths that, and no historical creation date is invented: a seeded
-- development database will show one tall bar, which is the truth about
-- when those rows were created.
create or replace function public.site_admin_dashboard_trends()
returns table (
  fixture_weeks jsonb,
  growth_daily jsonb,
  growth_monthly jsonb,
  adoption jsonb,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'Europe/London';
  -- LOCAL wall-clock anchors, deliberately `timestamp` and not `timestamptz`.
  -- Month and week arithmetic must happen in local time: subtracting months
  -- from a timestamptz does the sum in UTC, so crossing the BST/GMT
  -- boundary drags a bucket back onto the last day of the previous month
  -- (observed: 2025-10-31, 2025-11-30, 2025-12-31...). Two of those then
  -- formatted to the same month label and collided as React keys. Convert
  -- to timestamptz once, at the point of comparison, never before.
  v_local_week_start timestamp := date_trunc('week', now() at time zone v_tz);
  v_local_month_start timestamp := date_trunc('month', now() at time zone v_tz);
  v_week_start timestamptz := date_trunc('week', now() at time zone v_tz) at time zone v_tz;
  v_month_start timestamptz := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  v_today date := (now() at time zone v_tz)::date;
  v_active_clubs int;
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  -- The adoption denominator. ACTIVE Ovalball clubs -- never
  -- club_directory, which is addressable rugby-club inventory rather than
  -- activated customers, and would make every ratio meaninglessly small.
  select count(*)::int into v_active_clubs from public.clubs c where c.status = 'active';

  return query
  select
    -- ---------- 12 weeks of fixture activity, two labelled series ----------
    (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start', w.week_start,
               'booked', w.booked,
               'playing', w.playing
             ) order by w.week_start), '[]'::jsonb)
      from (
        select
          -- Local arithmetic, then a plain ::date. Both a bare
          -- `timestamptz::date` (session timezone) and timestamptz month/week
          -- arithmetic (UTC, DST-drifting) get this wrong; local wall-clock
          -- arithmetic does not.
          (v_local_week_start - (n || ' weeks')::interval)::date as week_start,
          (select count(*)::int from public.admin_fixture_overview f
            where f.is_primary_mirror = true
              and f.created_at >= (v_local_week_start - (n || ' weeks')::interval) at time zone v_tz
              and f.created_at <  (v_local_week_start - ((n - 1) || ' weeks')::interval) at time zone v_tz) as booked,
          (select count(*)::int from public.admin_fixture_overview f
            where f.is_primary_mirror = true
              and f.status <> 'Cancelled'
              and f.kickoff_date >= (v_local_week_start - (n || ' weeks')::interval)::date
              and f.kickoff_date <  (v_local_week_start - ((n - 1) || ' weeks')::interval)::date) as playing
        from generate_series(11, 0, -1) as n
      ) w
    ),

    -- ---------- 30 daily growth buckets ----------
    -- Each entity is scanned ONCE and grouped, then left-joined onto the
    -- bucket series. The obvious shape -- a correlated count per bucket --
    -- was measured first and cost 150 scans (30 days x 5 entities) because
    -- `(created_at at time zone tz)::date = day` is not sargable, so no
    -- index could have rescued it either. Grouping once is the fix; see
    -- the timings in docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md.
    (
      with days as (
        select g.day::date as day from generate_series(v_today - 29, v_today, interval '1 day') as g(day)
      ),
      u as (select (p.created_at at time zone v_tz)::date d, count(*)::int c from public.profiles p
            where p.created_at >= (v_today - 30)::timestamp at time zone v_tz group by 1),
      cl as (select (c.created_at at time zone v_tz)::date d, count(*)::int c from public.clubs c
            where c.created_at >= (v_today - 30)::timestamp at time zone v_tz group by 1),
      te as (select (t.created_at at time zone v_tz)::date d, count(*)::int c from public.teams t
            where t.created_at >= (v_today - 30)::timestamp at time zone v_tz group by 1),
      -- Distinct guardian PEOPLE, on the day each first became active. A
      -- parent of three children is one parent, once -- the same rule
      -- Platform Pulse uses, so the card and the chart cannot disagree.
      pa as (select (fg.first_at at time zone v_tz)::date d, count(*)::int c
             from (select gu.guardian_user_id, min(gu.created_at) first_at
                   from public.guardians gu where gu.status = 'active' group by 1) fg
             where fg.first_at >= (v_today - 30)::timestamp at time zone v_tz group by 1),
      pl as (select (pp.created_at at time zone v_tz)::date d, count(*)::int c from public.players pp
            where pp.created_at >= (v_today - 30)::timestamp at time zone v_tz group by 1)
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', days.day,
               'users', coalesce(u.c,0), 'clubs', coalesce(cl.c,0), 'teams', coalesce(te.c,0),
               'parents', coalesce(pa.c,0), 'players', coalesce(pl.c,0)
             ) order by days.day), '[]'::jsonb)
      from days
      left join u  on u.d  = days.day
      left join cl on cl.d = days.day
      left join te on te.d = days.day
      left join pa on pa.d = days.day
      left join pl on pl.d = days.day
    ),

    -- ---------- 12 monthly growth buckets ----------
    (
      with months as (
        select (v_local_month_start - (n || ' months')::interval)::date as m
        from generate_series(11, 0, -1) as n
      ),
      lo as (select (v_local_month_start - interval '11 months')::date as d),
      u as (select date_trunc('month', p.created_at at time zone v_tz)::date d, count(*)::int c
            from public.profiles p, lo where (p.created_at at time zone v_tz)::date >= lo.d group by 1),
      cl as (select date_trunc('month', c.created_at at time zone v_tz)::date d, count(*)::int c
            from public.clubs c, lo where (c.created_at at time zone v_tz)::date >= lo.d group by 1),
      te as (select date_trunc('month', t.created_at at time zone v_tz)::date d, count(*)::int c
            from public.teams t, lo where (t.created_at at time zone v_tz)::date >= lo.d group by 1),
      pa as (select date_trunc('month', fg.first_at at time zone v_tz)::date d, count(*)::int c
             from (select gu.guardian_user_id, min(gu.created_at) first_at
                   from public.guardians gu where gu.status = 'active' group by 1) fg, lo
             where (fg.first_at at time zone v_tz)::date >= lo.d group by 1),
      pl as (select date_trunc('month', pp.created_at at time zone v_tz)::date d, count(*)::int c
            from public.players pp, lo where (pp.created_at at time zone v_tz)::date >= lo.d group by 1)
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', months.m,
               'users', coalesce(u.c,0), 'clubs', coalesce(cl.c,0), 'teams', coalesce(te.c,0),
               'parents', coalesce(pa.c,0), 'players', coalesce(pl.c,0)
             ) order by months.m), '[]'::jsonb)
      from months
      left join u  on u.d  = months.m
      left join cl on cl.d = months.m
      left join te on te.d = months.m
      left join pa on pa.d = months.m
      left join pl on pl.d = months.m
    ),

    -- ---------- adoption, over ACTIVE clubs ----------
    jsonb_build_object(
      'active_clubs', v_active_clubs,
      'with_active_teams', (
        select count(distinct t.club_id)::int from public.teams t
        join public.clubs c on c.id = t.club_id and c.status = 'active'
        where t.active = true and t.folded_at is null and t.archived_at is null),
      'with_fixtures', (
        select count(*)::int from public.clubs c
        where c.status = 'active' and exists (
          select 1 from public.admin_fixture_overview f
          where f.is_primary_mirror = true
            and (f.owning_club_id = c.id or f.opponent_club_id = c.id))),
      -- "Using Training Management" is a real plan or a real planned
      -- session -- never "the menu item is visible to them".
      'using_training', (
        select count(*)::int from public.clubs c
        where c.status = 'active' and (
          exists (select 1 from public.training_plans tp where tp.club_id = c.id and tp.status = 'ACTIVE')
          or exists (select 1 from public.training_sessions ts
                     where ts.club_id = c.id and ts.status = 'PLANNED' and ts.cancelled_at is null))),
      -- A club has parent/player adoption when a player at one of its teams
      -- has an active guardian. Counted as clubs; no player or guardian
      -- identity leaves this function.
      'with_parent_player', (
        select count(distinct t.club_id)::int
        from public.guardians gu
        join public.player_team_memberships ptm on ptm.player_id = gu.player_id
        join public.teams t on t.id = ptm.team_id
        join public.clubs c on c.id = t.club_id and c.status = 'active'
        where gu.status = 'active'),
      -- Member payments is Domain B (a club charging its own members) and
      -- is reported here only as an adoption count -- no amounts, and never
      -- mixed with Ovalball SaaS money.
      'with_member_payments', (
        select count(*)::int from public.clubs c
        where c.status = 'active'
          and exists (select 1 from public.club_subscription_programmes pr
                      where pr.club_id = c.id and pr.enabled = true)
          and exists (select 1 from public.gocardless_merchant_connections gc
                      where gc.club_id = c.id and gc.disconnected_at is null)),
      'with_partner_clubs', (
        select count(distinct x.club_id)::int from (
          select cp.requesting_club_id as club_id from public.club_partnerships cp where cp.status = 'active'
          union
          select cp.partner_club_id from public.club_partnerships cp where cp.status = 'active'
        ) x join public.clubs c on c.id = x.club_id and c.status = 'active'),
      -- Claim funnel. Starts at CLAIM SUBMITTED, never at the directory:
      -- those clubs were ingested, not contacted, so a directory-based
      -- conversion rate would be a fiction.
      'claims_submitted', (select count(distinct cc.directory_id)::int from public.club_claims cc),
      'claims_approved', (select count(distinct cc.directory_id)::int from public.club_claims cc where cc.status = 'verified')
    ),

    now();
end;
$$;

revoke execute on function public.site_admin_dashboard_trends() from public, anon, authenticated;
grant execute on function public.site_admin_dashboard_trends() to authenticated;

comment on function public.site_admin_dashboard_trends is
  'Site Admin dashboard: every Phase B chart in one long-cache call -- 12 weeks of fixture activity (booked by creation time, playing by kickoff), 30 daily and 12 monthly growth buckets, and feature adoption over ACTIVE clubs (never club_directory). Aggregates only: no names, dates of birth, emails or player rows. Requires Site Admin.';

-- =====================================================================
-- 4. No ambiguous overloads left behind
-- =====================================================================

do $$
declare
  v_name text;
  v_count int;
begin
  foreach v_name in array array[
    'site_admin_dashboard_platform',
    'site_admin_dashboard_operations',
    'site_admin_dashboard_commercial',
    'site_admin_dashboard_fixtures_today',
    'site_admin_dashboard_trends'
  ] loop
    select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;

    if v_count <> 1 then
      raise exception 'Expected exactly one %, found %.', v_name, v_count;
    end if;
  end loop;
end $$;

-- Site Admin Dashboard, Phase A -- the canonical read model.
--
-- The dashboard needs roughly forty aggregates. Forty round trips through
-- PostgREST, each re-evaluating an RLS predicate on every row of every
-- table, is the failure mode the Stage 1 audit warned about. So: three
-- functions, grouped by how often their answers change, each returning one
-- row.
--
--   platform     -- who is on Ovalball. Changes slowly.
--   operations   -- what needs doing right now. Changes constantly.
--   commercial   -- money and referrals. Separately authorized.
--
-- Every one is SECURITY DEFINER, and every one authorizes as its first
-- meaningful action. SECURITY DEFINER is used here because these are
-- aggregates over tables whose RLS predicates would otherwise be evaluated
-- per row for a caller who is, by the guard above, allowed to see all of
-- them anyway -- not to bypass a boundary, but to check it once instead of
-- a hundred thousand times. The guard is the boundary, and it is the first
-- statement in each body.
--
-- Nothing here invents a metric. Every definition is the one established in
-- docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md, and the awkward ones are
-- awkward on purpose:
--
--   * guardians are RELATIONSHIP rows, so "parents" counts distinct people;
--   * players are not users, and the two are never summed;
--   * clubs.created_at IS the activation moment (a clubs row only exists
--     after approve_club_claim), which is why there is no separate
--     activated_at anywhere in this file;
--   * club_directory is addressable market, not customers, and is reported
--     under its own name so it can never be mistaken for a club count.
--
-- There is deliberately no test-data filtering. No canonical marker exists,
-- and inferring one from an email domain, a name or a creation date would
-- make production analytics quietly wrong (owner Decision B).

-- =====================================================================
-- 0. Fix a defect Phase F0 introduced: a leftover function overload
-- =====================================================================

-- 20261012000000 gave internal.reconcile_partner_invitations a third
-- parameter (p_reference_at, defaulted). `create or replace function`
-- cannot change a signature, so it created a SECOND function rather than
-- replacing the first, and both are now live:
--
--   internal.reconcile_partner_invitations(uuid, uuid)
--   internal.reconcile_partner_invitations(uuid, uuid, timestamptz)
--
-- Because the third parameter has a default, a two-argument call now
-- matches both and Postgres refuses it:
--   ERROR: function internal.reconcile_partner_invitations(unknown, uuid)
--          is not unique
--
-- Production behaviour was never wrong -- the only live caller,
-- approve_club_claim, passes three arguments explicitly, and the two
-- two-argument call sites are inside function bodies that 20261012000000
-- itself superseded. But an ambiguous overload is a landmine for the next
-- caller, and it already breaks supabase/tests/partner_club_invitations.sql.
-- This codebase has been here before: see
-- 20261011120000_duplicate_function_overload_fix.sql.
--
-- Dropping the stale two-argument form is safe precisely because nothing
-- live calls it, and it restores the two-argument call to an unambiguous
-- match on the three-argument function's default.
drop function if exists internal.reconcile_partner_invitations(uuid, uuid);

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'reconcile_partner_invitations';

  if v_count <> 1 then
    raise exception 'Expected exactly one reconcile_partner_invitations, found %.', v_count;
  end if;
end $$;

-- =====================================================================
-- 1. Platform -- who is on Ovalball
-- =====================================================================

create or replace function public.site_admin_dashboard_platform()
returns table (
  registered_users int,
  suspended_users int,
  registered_clubs int,
  active_clubs int,
  registered_teams int,
  active_teams int,
  registered_parents int,
  registered_players int,
  active_players int,
  directory_clubs int,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  return query
  select
    -- A completed person account. profiles is written by
    -- completeSignupIfNeeded, so this excludes half-finished signups --
    -- which auth.users would have counted.
    (select count(*)::int from public.profiles),
    (select count(*)::int from public.profiles p where p.account_status = 'suspended'),

    -- A clubs row exists only once approve_club_claim has run, so every
    -- row here is an activated club. club_directory is NOT this.
    (select count(*)::int from public.clubs),
    (select count(*)::int from public.clubs c where c.status = 'active'),

    (select count(*)::int from public.teams),
    (select count(*)::int from public.teams t
      where t.active = true and t.folded_at is null and t.archived_at is null),

    -- DISTINCT PEOPLE. public.guardians is one row per
    -- (guardian_user_id, player_id) pair, so count(*) would report a parent
    -- of three children as three parents.
    (select count(distinct g.guardian_user_id)::int from public.guardians g
      where g.status = 'active'),

    -- Players are sporting identities, not accounts: players.user_id is
    -- nullable. Never added to registered_users.
    (select count(*)::int from public.players),
    (select count(*)::int from public.players pl where pl.active = true),

    -- Addressable market. Named so it cannot be mistaken for a club count.
    (select count(*)::int from public.club_directory d where d.active = true),

    now();
end;
$$;

revoke execute on function public.site_admin_dashboard_platform() from public, anon, authenticated;
grant execute on function public.site_admin_dashboard_platform() to authenticated;

comment on function public.site_admin_dashboard_platform is
  'Site Admin dashboard: canonical platform population counts. Registered parents are distinct guardian PEOPLE, not guardian relationship rows; players are sporting identities and are never summed with users; directory_clubs is addressable market, not customers. Requires Site Admin.';

-- =====================================================================
-- 2. Operations -- what needs doing right now
-- =====================================================================

-- Deliberately a subset of the twelve operational signals the audit
-- catalogued. These five are the ones that are simultaneously cheap,
-- unambiguous, and already have a real Site Admin destination to send
-- someone to. A dashboard that cries wolf about nine things nobody can act
-- on is worse than one that names five they can.
create or replace function public.site_admin_dashboard_operations()
returns table (
  fixtures_today int,
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
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  return query
  select
    -- is_primary_mirror is the established dedup contract for the fixture
    -- read model (see app/(app)/admin/fixtures/query.ts): a confirmed
    -- two-sided fixture is ONE row, and historical mirror pairs from before
    -- the consolidation must not be counted twice.
    (select count(*)::int from public.admin_fixture_overview f
      where f.kickoff_date = current_date
        and f.is_primary_mirror = true
        and f.status <> 'Cancelled'),

    (select count(*)::int from public.club_claims cc where cc.status = 'pending'),
    (select count(*)::int from public.directory_requests dr where dr.status = 'pending'),

    -- "Stuck" is a product judgement, not a canonical state: a request
    -- still unanswered after two weeks is one somebody should chase.
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
  'Site Admin dashboard: near-real-time operational signals, each with a real Site Admin destination. Fixtures are deduped with is_primary_mirror. Requires Site Admin.';

-- =====================================================================
-- 3. Commercial -- separately authorized
-- =====================================================================

-- site.commercial.view on top of Site Admin, matching /admin/commercial.
-- A Site Admin without it does not get this data filtered or blanked: the
-- function refuses, and the page omits the section server-side.
create or replace function public.site_admin_dashboard_commercial()
returns table (
  clubs_on_trial int,
  trials_ending_soon int,
  active_subscriptions int,
  past_due_subscriptions int,
  awaiting_mandate int,
  referral_health_status text,
  referrals_total int,
  referrals_awaiting_activation int,
  referrals_registered int,
  referrals_qualified int,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_health record;
begin
  if not (internal.is_site_admin() and internal.has_capability('site.commercial.view', 'site')) then
    raise exception 'Commercial visibility is required.' using errcode = '42501';
  end if;

  -- One canonical source for referral health -- F0's function, not a second
  -- opinion assembled here. If its semantics change, this follows.
  select h.status into v_health from public.referral_data_health() h;

  return query
  select
    (select count(*)::int from public.platform_trials t
      where t.status in ('active', 'paused')),

    -- Only a RUNNING clock can be close to ending. A trial paused by Beta
    -- is not counted down, so counting it as "ending soon" would be a lie
    -- the Beta engine itself contradicts.
    (select count(*)::int from public.platform_trials t
      where t.status = 'active'
        and internal.trial_remaining_seconds(t.entitlement_seconds, t.consumed_seconds, t.accruing_since)
            <= 7 * 86400),

    (select count(*)::int from public.platform_club_subscriptions s
      where s.status in ('active', 'scheduled')),
    (select count(*)::int from public.platform_club_subscriptions s
      where s.status = 'past_due'),
    (select count(*)::int from public.platform_club_subscriptions s
      where s.status = 'pending_setup' and s.provider_mandate_id is null),

    v_health.status,

    (select count(*)::int from public.platform_referrals r),
    (select count(*)::int from public.platform_referrals r where r.status = 'pending'),
    (select count(*)::int from public.platform_referrals r where r.status = 'registered'),
    (select count(*)::int from public.platform_referrals r where r.status = 'qualified'),

    now();
end;
$$;

revoke execute on function public.site_admin_dashboard_commercial() from public, anon, authenticated;
grant execute on function public.site_admin_dashboard_commercial() to authenticated;

comment on function public.site_admin_dashboard_commercial is
  'Site Admin dashboard: Ovalball SaaS subscription state and referral funnel counts, plus the canonical referral_data_health() status. This is what clubs pay Ovalball -- never what a club''s own members pay the club. Requires Site Admin AND site.commercial.view.';

-- =====================================================================
-- 4. Indexes -- none, and the measurement that says so
-- =====================================================================

-- Stage 1 listed nine candidate indexes. Phase A adds ZERO, because the
-- query plans say none is earning its place yet.
--
-- Every Phase A platform count is an unfiltered aggregate (all profiles,
-- all clubs, all teams). A sequential scan is the correct plan for those
-- and an index would be pure write-side cost.
--
-- The one genuinely selective read is "fixtures playing today, across every
-- club". It looked like the obvious index candidate, so it was measured
-- rather than assumed:
--
--   explain (analyze, buffers)
--     select count(*) from public.fixtures where kickoff_date = current_date;
--
--   Aggregate (actual time=0.024..0.025 rows=1)
--     Buffers: shared hit=3
--     ->  Seq Scan on fixtures  (Rows Removed by Filter: 41)
--   Execution Time: 0.061 ms
--
-- A btree on fixtures(kickoff_date) was created, measured, and REMOVED: the
-- planner declined to use it, correctly, because the whole table is three
-- pages. Shipping it would have been an index the evidence says is dead.
--
-- Add it when the access pattern actually costs something -- as a guide,
-- when public.fixtures exceeds roughly 50k rows, or when the operations RPC
-- exceeds ~50 ms. Note the existing fixtures_owning_team_id_idx
-- (owning_team_id, kickoff_date) will NOT serve it: its leading column is
-- the team, and a cross-club query supplies no owning_team_id.
--
-- Phase A whole-RPC timings on the local dataset, warm:
--   site_admin_dashboard_platform    ~0.9 ms
--   site_admin_dashboard_operations  ~0.7 ms
--   site_admin_dashboard_commercial  ~8.7 ms
--
-- That is also why Phase A does no cross-request caching: there is nothing
-- to save yet, and caching privileged aggregates across users would need a
-- correctness argument this phase does not need to make.

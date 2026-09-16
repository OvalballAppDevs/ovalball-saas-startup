-- =====================================================================================================
-- SLICE 4H (4/4) — THE FINANCE POLICIES, AND THE ADAPTER ROWS
--
-- Twenty-three row policies across the club's money -- subscription pricing and programmes, membership
-- obligations, payers, refunds, the whole GoCardless surface, and Ovalball's own platform billing --
-- still ask the deprecated club.subscription.*, club.platform_billing.* and club.edit_profile keys
-- through capability_key_map. They resolve correctly today, which is exactly why they were easy to
-- miss: the adapter has been answering for them since Slice 3.
--
-- They move with the RPCs above them, because a table whose policy asks one key and whose RPC asks
-- another is a table with two answers waiting to disagree.
--
-- SHAPE: these calls were already correlated -- internal.has_capability(key, 'club', club_id) runs once
-- per row today. The rewrite swaps the key and nothing else, so it introduces no new per-row call; it
-- does make each one heavier, and section 3 measures that rather than assuming it away.
-- =====================================================================================================

do $$
declare
  v_map constant text[][] := array[
    ['club.subscription.view_finance',           'finance.subscription.view'],
    ['club.subscription.configure',              'finance.subscription.configure'],
    ['club.subscription.manage_enrolment',       'finance.enrolment.manage'],
    ['club.subscription.manage_payment_actions', 'finance.payment.act'],
    ['club.subscription.export',                 'finance.subscription.export'],
    ['club.gocardless.connect',                  'finance.gocardless.connect'],
    ['club.platform_billing.view',               'finance.platform_billing.view'],
    ['club.platform_billing.manage',             'finance.platform_billing.manage'],
    ['club.edit_profile',                        'club.profile.edit']
  ];
  r record;
  v_qual text; v_check text; v_sql text; i int; v_touched int := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
          '''(club\.(subscription|platform_billing|gocardless|edit_profile)[a-z_.]*)'''
    order by tablename, policyname
  loop
    v_qual := r.qual; v_check := r.with_check;
    for i in 1 .. array_length(v_map, 1) loop
      v_qual  := replace(coalesce(v_qual, ''),  '''' || v_map[i][1] || '''', '''' || v_map[i][2] || '''');
      v_check := replace(coalesce(v_check, ''), '''' || v_map[i][1] || '''', '''' || v_map[i][2] || '''');
    end loop;
    -- has_capability takes four arguments and can takes five; the adapter lookup is what goes.
    v_qual  := regexp_replace(v_qual,  'internal\.has_capability\((''(?:finance|club)\.[a-z_.]+''), ''club''::text, ([^)]+)\)',
                              'internal.can(\1, ''club''::text, \2, NULL::uuid, NULL::uuid)', 'g');
    v_check := regexp_replace(v_check, 'internal\.has_capability\((''(?:finance|club)\.[a-z_.]+''), ''club''::text, ([^)]+)\)',
                              'internal.can(\1, ''club''::text, \2, NULL::uuid, NULL::uuid)', 'g');

    v_sql := format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute v_sql;
    v_sql := format('create policy %I on %I.%I for %s to %s',
                    r.policyname, r.schemaname, r.tablename,
                    case r.cmd when 'ALL' then 'all' when 'SELECT' then 'select' when 'INSERT' then 'insert'
                               when 'UPDATE' then 'update' else 'delete' end,
                    array_to_string(r.roles, ', '));
    if coalesce(v_qual, '') <> '' then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if coalesce(v_check, '') <> '' then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
    v_touched := v_touched + 1;
  end loop;
  raise notice 'Slice 4H: % finance policies moved onto the canonical keys', v_touched;
end $$;

-- internal.assert_club_setup_authority, the last database caller of club.edit_profile.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'assert_club_setup_authority';
  if v_def is not null and position('club.edit_profile' in v_def) > 0 then
    v_def := replace(v_def, '''club.edit_profile''', '''club.profile.edit''');
    v_def := regexp_replace(v_def, 'internal\.has_capability\(''club\.profile\.edit'', ''club'', ([a-zA-Z0-9_\.]+)\)',
                            'internal.can(''club.profile.edit'', ''club'', \1, null, null)', 'g');
    execute v_def;
  end if;
end $$;

-- The adapter rows, retired -----------------------------------------------------------------------------
-- Nine legacy keys whose last caller this slice removed. NOT retired, and named so the omission reads as
-- a decision: club.season_rollover.manage and club.guardians.manage still have callers in surfaces that
-- belong to AA.3 rows 4i and 4a, and permissions.club_manage is J.3's MERGE which 4H completes only
-- because it already had none.
do $$
declare v_bad text[];
begin
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','internal')
    and p.prosrc ~ '''(club\.(subscription|platform_billing|gocardless|edit_profile|capabilities)[a-z_.]*|permissions\.club_manage)''';
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4H legacy key still has a database caller: %', array_to_string(v_bad, ', ');
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
        '''(club\.(subscription|platform_billing|gocardless|edit_profile|capabilities)[a-z_.]*|permissions\.club_manage)''';
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4H legacy key is still in a policy: %', array_to_string(v_bad, ', ');
  end if;
end $$;

delete from public.capability_key_map
where legacy_key in (
  'club.edit_profile',
  'club.subscription.view_finance', 'club.subscription.configure', 'club.subscription.manage_enrolment',
  'club.subscription.manage_payment_actions', 'club.subscription.export',
  'club.gocardless.connect',
  'club.platform_billing.view', 'club.platform_billing.manage',
  'club.capabilities.manage', 'permissions.club_manage');

do $$
begin
  if exists (select 1 from public.capability_key_map where legacy_key in (
      'club.edit_profile','club.subscription.view_finance','club.subscription.configure',
      'club.subscription.manage_enrolment','club.subscription.manage_payment_actions','club.subscription.export',
      'club.gocardless.connect','club.platform_billing.view','club.platform_billing.manage',
      'club.capabilities.manage','permissions.club_manage')) then
    raise exception 'a Slice 4H adapter row survived.';
  end if;
  -- The two that stay, and whose staying is the point.
  if not exists (select 1 from public.capability_key_map where legacy_key = 'club.season_rollover.manage')
     or not exists (select 1 from public.capability_key_map where legacy_key = 'club.guardians.manage') then
    raise exception 'an adapter row belonging to another slice was retired by 4H.';
  end if;
end $$;

-- Two policies the first pass missed ---------------------------------------------------------------------
-- clubs_update_admin: the key swapped and the FUNCTION did not, because pg_policies renders the
-- argument as 'club.profile.edit'::text and the rewrite's pattern did not allow for the cast. The
-- authority_helper_retirement ledger is what caught it -- the policy was asking the canonical key
-- through the legacy adapter, which resolves correctly and would have sat there indefinitely.
--
-- teams_update_admin: on a table this slice owns, and never rewritten at all. Its two keys belong to
-- J.5 and are AA.3 rows 4b's and 4i's to RETIRE; the policy on 4H's own table is 4H's to canonicalise,
-- so the keys move here and their adapter rows stay for the slices that still have callers.
drop policy if exists clubs_update_admin on public.clubs;
create policy clubs_update_admin on public.clubs
  for update using (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or id in (select unnest(internal.club_ids_with('club.profile.edit')))
  );

drop policy if exists teams_update_admin on public.teams;
create policy teams_update_admin on public.teams
  for update using (
    (select internal.has_site_capability('site.team_roles.manage'))
    or club_id in (select unnest(internal.club_ids_with('team.team.manage')))
    or club_id in (select unnest(internal.club_ids_with('team.lifecycle.manage')))
  );

do $$
declare v_bad text[];
begin
  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('clubs','teams','club_memberships','role_assignments','club_join_requests',
                      'invitations','invitation_teams','club_contacts','team_contacts','club_opponent_notes')
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
        '\m(is_club_admin|is_site_admin|is_full_site_admin|has_capability)\(';
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4H table policy still asks a legacy helper: %', array_to_string(v_bad, ', ');
  end if;
end $$;

-- =====================================================================================================
-- SLICE 7 (2/n) -- is_site_admin() leaves the policies (Phase 2 Q.1, Z.4 PG-15, slice row 7d)
--
-- Phase 1 counted 140 policies containing a Site Admin shortcut. Q.1 says the target is 0, and the
-- Slice 7 acceptance criterion is exactly that: **PG-15 = 0**.
--
-- WHY THIS IS A NARROWING, NOT A REMOVAL OF AUTHORITY.
--
-- `internal.is_site_admin()` is true for ANY active Site Admin, whatever their profile. So today a
-- READ_ONLY Site Admin can UPDATE the club directory, INSERT a club alias and DELETE a competition
-- entry -- because the policy asks "are you a Site Admin", which is a question about a label rather
-- than about authority. Replacing it with `internal.has_site_capability('<key>')` asks the canonical
-- question instead, and the answer respects the profile bundle. Read Only loses what it should never
-- have had; Full keeps what it legitimately holds. That is the whole of 7d.
--
-- HOW THE SUBSTITUTION IS DONE. Surgically. Each policy keeps its own expression and only the Site
-- Admin branch is swapped, so `(claimant_user_id = auth.uid() OR is_site_admin())` becomes
-- `(claimant_user_id = auth.uid() OR has_site_capability('site.claims.review'))` -- the self branch is
-- untouched. Rewriting ninety policies by hand would have been ninety chances to drop a clause.
--
-- EVERY TABLE IS NAMED. There is no default capability: a table that reaches this migration without a
-- mapping raises. A fallback would mean the next table somebody adds silently inherits whatever the
-- fallback happened to be, which is how a broad helper grows back.
-- =====================================================================================================

-- The mapping lives inside the block that uses it. A temporary table would not survive psql's
-- statement-level autocommit when this file is replayed by hand, and a migration that only works
-- under one runner is a migration that will fail under the other.
do $$
declare
  r record;
  v_map jsonb;
  v_key text;
  v_qual text;
  v_check text;
  v_roles text;
  v_cmd text;
  v_done int := 0;
  v_unmapped text;
begin
  -- table -> [read capability, write capability]. EVERY table is named; there is no default.
  select jsonb_object_agg(m.schema_name || '.' || m.table_name,
                          jsonb_build_array(m.read_key, m.write_key))
    into v_map
    from (values
  -- Directory and the clubs register. DATA and FULL curate it; everyone else reads the active rows
  -- through the public branch that is already in the policy.
  ('public','club_directory',                     'site.directory.manage','site.directory.manage'),
  ('public','club_aliases',                       'site.directory.manage','site.directory.manage'),
  ('public','club_directory_research_proposals',  'site.directory.manage','site.directory.manage'),
  ('public','club_directory_rugby_code_corrections','site.directory.manage','site.directory.manage'),
  ('public','directory_requests',                 'site.directory.manage','site.directory.manage'),
  ('public','directory_verification_runs',        'site.directory.manage','site.directory.manage'),
  ('public','directory_verification_run_records', 'site.directory.manage','site.directory.manage'),
  ('public','unresolved_names',                   'site.lookups.manage','site.lookups.manage'),
  ('public','constituent_bodies',                 'site.lookups.manage','site.lookups.manage'),

  -- Claims are their own review authority, not "directory" and not "clubs".
  ('public','club_claims',                        'site.claims.review','site.claims.review'),
  ('public','club_setup_state',                   'site.clubs.view','site.clubs.lifecycle'),

  -- Money. Viewing and changing commercial arrangements are deliberately different keys.
  ('public','club_subscription_pricing',          'site.commercial.view','site.commercial.manage'),
  ('public','club_subscription_programmes',       'site.commercial.view','site.commercial.manage'),
  ('public','club_subscription_sibling_rules',    'site.commercial.view','site.commercial.manage'),
  ('public','membership_obligations',             'site.commercial.view','site.commercial.manage'),
  ('public','payment_refunds',                    'site.commercial.view','site.commercial.manage'),
  ('public','finance_audit_log',                  'site.commercial.view','site.commercial.manage'),
  ('public','player_subscription_payers',         'site.commercial.view','site.commercial.manage'),
  ('public','platform_club_subscriptions',        'site.commercial.view','site.commercial.manage'),
  ('public','platform_credits',                   'site.commercial.view','site.commercial.manage'),
  ('public','platform_payments',                  'site.commercial.view','site.commercial.manage'),
  ('public','platform_plans',                     'site.commercial.view','site.commercial.manage'),
  ('public','platform_provider_events',           'site.commercial.view','site.commercial.manage'),
  ('public','platform_referrals',                 'site.commercial.view','site.commercial.manage'),
  ('public','platform_subscription_events',       'site.commercial.view','site.commercial.manage'),
  ('public','platform_trials',                    'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_billing_requests',        'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_customers',               'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_events',                  'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_mandates',                'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_payments',                'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_payouts',                 'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_reconciliation_entries',  'site.commercial.view','site.commercial.manage'),
  ('public','gocardless_subscriptions',           'site.commercial.view','site.commercial.manage'),

  -- Platform state. Releases and mode are the release authority, not "commercial".
  ('public','platform_releases',                  'site.system.release.manage','site.system.release.manage'),
  ('public','platform_mode_events',               'site.system.release.manage','site.system.release.manage'),

  -- Fixtures, competitions and the support tooling around them.
  ('public','competitions',                       'site.competitions.manage','site.competitions.manage'),
  ('public','competition_editions',               'site.competitions.manage','site.competitions.manage'),
  ('public','competition_edition_teams',          'site.competitions.manage','site.competitions.manage'),
  ('public','fixture_import_batches',             'site.fixtures.support','site.fixtures.support'),
  ('public','fixture_import_rows',                'site.fixtures.support','site.fixtures.support'),
  ('public','fixture_source_refs',                'site.fixtures.support','site.fixtures.support'),
  ('public','pitch_allocation_proposals',         'site.fixtures.support','site.fixtures.support'),
  ('public','pitch_allocation_proposal_items',    'site.fixtures.support','site.fixtures.support'),
  ('public','player_fixture_attendance',          'site.fixtures.view','site.fixtures.support'),

  -- Email.
  ('public','email_brand_settings',               'site.email.manage','site.email.manage'),
  ('public','email_template_settings',            'site.email.manage','site.email.manage'),
  ('public','email_template_versions',            'site.email.manage','site.email.manage'),
  ('public','email_delivery_policy_audit',        'site.email.manage','site.email.manage'),
  ('public','email_deliveries',                   'site.email.deliveries.view','site.email.manage'),

  -- People and the record of what was done to them. Reading an audit trail and changing somebody's
  -- access are not the same authority, and these keys keep them apart.
  ('public','profiles',                           'site.users.view','site.users.identity.correct'),
  ('public','policy_acknowledgements',            'site.users.view','site.users.view'),
  ('public','terms_acceptances',                  'site.users.view','site.users.view'),
  ('public','player_club_join_requests',          'site.clubs.view','site.memberships.manage'),
  ('public','audit_log',                          'site.audit.view','site.audit.view'),
  ('public','security_events',                    'site.security_events.view','site.security_events.view'),
  ('public','access_review_items',                'site.permissions.manage','site.permissions.manage'),
  ('public','permission_groups',                  'site.permissions.manage','site.permissions.manage'),
  ('public','site_admin_diagnostic_sessions',     'site.support.view_club','site.support.view_club'),

  -- Site Admin itself. Only FULL holds site.admins.manage, which is what keeps the two-admin rule real.
  ('public','site_admins',                        'site.admins.manage','site.admins.manage'),
  ('public','site_admin_invitations',             'site.admins.manage','site.admins.manage'),

  -- Storage. Club crests and brand assets are directory curation.
  ('storage','objects',                           'site.directory.manage','site.directory.manage')
    ) as m(schema_name, table_name, read_key, write_key);
  -- Nothing may be missed. A table that carries one of these policies and has no mapping stops the
  -- migration rather than being left behind or given a default.
  select string_agg(distinct p.schemaname || '.' || p.tablename, ', ') into v_unmapped
    from pg_policies p
   where p.schemaname in ('public','storage')
     and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) ~ '\m(is_site_admin|is_full_site_admin|is_club_admin)\('
     and not (v_map ? (p.schemaname || '.' || p.tablename));
  if v_unmapped is not null then
    raise exception 'Slice 7: no capability mapped for %. Name it rather than defaulting it.', v_unmapped;
  end if;

  -- NO DEPRECATED KEY MAY BE MAPPED. internal.capability_decision refuses a retired capability at rule
  -- 1, so a policy pointing at one denies EVERYBODY -- including a Full Site Admin. That is an
  -- authority loss dressed as a tightening, and it is harder to notice than a widening because nothing
  -- is exposed; somebody simply cannot do their job. Two deprecated keys were caught here by this
  -- check: site.diagnostic.access and site.fixture_support.manage.
  select string_agg(distinct k, ', ') into v_unmapped
    from (select jsonb_array_elements_text(v) as k from jsonb_each(v_map) as e(key, v)) d
   where exists (select 1 from public.capabilities c where c.key = d.k and c.status <> 'ACTIVE')
      or not exists (select 1 from public.capabilities c where c.key = d.k);
  if v_unmapped is not null then
    raise exception 'Slice 7: mapped to a capability that is deprecated or does not exist: %', v_unmapped;
  end if;

  for r in
    select p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check,
           (v_map -> (p.schemaname || '.' || p.tablename) ->> 0) as read_key,
           (v_map -> (p.schemaname || '.' || p.tablename) ->> 1) as write_key
      from pg_policies p
     where p.schemaname in ('public','storage')
       and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) ~ '\m(is_site_admin|is_full_site_admin|is_club_admin)\('
       and (v_map ? (p.schemaname || '.' || p.tablename))
     order by p.schemaname, p.tablename, p.policyname
  loop
    -- A SELECT policy gets the read key; anything that writes gets the write key.
    v_key := case when r.cmd = 'SELECT' then r.read_key else r.write_key end;

    -- PER-POLICY OVERRIDES, for a table whose policies do not share one authority. Email branding is
    -- its own key and its own profile: site.email.manage is FULL only, which is what the bucket had
    -- before as is_full_site_admin().
    if r.schemaname = 'storage' and r.tablename = 'objects' and r.policyname like 'email_brand_%' then
      v_key := 'site.email.manage';
    end if;

    v_qual  := r.qual;
    v_check := r.with_check;
    -- Only the Site Admin branch is swapped. Everything else in the expression survives untouched.
    v_qual  := regexp_replace(coalesce(v_qual, ''),
                 '\m(internal\.)?(is_site_admin|is_full_site_admin|is_club_admin)\(\)',
                 format('internal.has_site_capability(%L)', v_key), 'g');
    v_check := regexp_replace(coalesce(v_check, ''),
                 '\m(internal\.)?(is_site_admin|is_full_site_admin|is_club_admin)\(\)',
                 format('internal.has_site_capability(%L)', v_key), 'g');

    v_roles := array_to_string(r.roles, ', ');
    v_cmd := case r.cmd when 'ALL' then 'ALL' else r.cmd end;

    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      r.policyname, r.schemaname, r.tablename,
      case when r.permissive = 'PERMISSIVE' then 'PERMISSIVE' else 'RESTRICTIVE' end,
      v_cmd, v_roles,
      case when nullif(v_qual,'') is not null then 'using (' || v_qual || ')' else '' end,
      case when nullif(v_check,'') is not null then 'with check (' || v_check || ')' else '' end);

    v_done := v_done + 1;
  end loop;

  raise notice 'Slice 7: % policies moved from a Site Admin label to a named capability', v_done;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Reconciliation: repair any policy left pointing at a DEPRECATED capability.
--
-- Written as its own unconditional step so this migration is correct whichever state it finds. A
-- policy naming a retired capability denies everybody, including a Full Site Admin -- an authority
-- LOSS, which is harder to spot than a widening because nothing is exposed; somebody simply cannot do
-- their job and assumes it was always that way.
--
-- Two were caught here: site.diagnostic.access and site.fixture_support.manage, both retired, both
-- replaced by their active successors (site.support.view_club and site.fixtures.support).
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  r record; v_qual text; v_check text; v_n int := 0;
  v_fix jsonb := jsonb_build_object(
    'site.diagnostic.access',      'site.support.view_club',
    'site.fixture_support.manage', 'site.fixtures.support');
  k text;
begin
  for r in
    select p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
      from pg_policies p
     where p.schemaname in ('public','storage')
       and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) ~ '(site\.diagnostic\.access|site\.fixture_support\.manage)'
  loop
    v_qual := coalesce(r.qual, ''); v_check := coalesce(r.with_check, '');
    for k in select jsonb_object_keys(v_fix) loop
      v_qual  := replace(v_qual,  k, v_fix ->> k);
      v_check := replace(v_check, k, v_fix ->> k);
    end loop;
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      r.policyname, r.schemaname, r.tablename,
      case when r.permissive = 'PERMISSIVE' then 'PERMISSIVE' else 'RESTRICTIVE' end,
      r.cmd, array_to_string(r.roles, ', '),
      case when nullif(v_qual,'') is not null then 'using (' || v_qual || ')' else '' end,
      case when nullif(v_check,'') is not null then 'with check (' || v_check || ')' else '' end);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    raise notice 'Slice 7: % policies repaired off a deprecated capability', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The email-brand bucket, set explicitly rather than inherited from the table.
--
-- Written as its own step, and unconditionally, so it is correct whichever state this migration finds:
-- freshly converting the legacy helper, or re-running over policies already converted. The table-level
-- key for storage.objects is the club-crest one, and site.directory.manage is held by DATA as well as
-- FULL -- so inheriting it here would hand a second profile write access to Ovalball's email branding,
-- which is exactly the widening 7d must not do.
-- ---------------------------------------------------------------------------------------------------
do $$
declare r record; v_qual text; v_check text; v_n int := 0;
begin
  for r in
    select p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
       and p.policyname like 'email_brand_%'
       and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) ~ 'site\.directory\.manage'
  loop
    v_qual  := regexp_replace(coalesce(r.qual, ''),  'site\.directory\.manage', 'site.email.manage', 'g');
    v_check := regexp_replace(coalesce(r.with_check, ''), 'site\.directory\.manage', 'site.email.manage', 'g');
    execute format('drop policy %I on storage.objects', r.policyname);
    execute format('create policy %I on storage.objects as %s for %s to %s %s %s',
      r.policyname,
      case when r.permissive = 'PERMISSIVE' then 'PERMISSIVE' else 'RESTRICTIVE' end,
      r.cmd, array_to_string(r.roles, ', '),
      case when nullif(v_qual,'') is not null then 'using (' || v_qual || ')' else '' end,
      case when nullif(v_check,'') is not null then 'with check (' || v_check || ')' else '' end);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    raise notice 'Slice 7: % email-brand policies pinned to site.email.manage (FULL only)', v_n;
  end if;
end $$;

do $$
declare v int;
begin
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
              and policyname like 'email_brand_%' and cmd in ('INSERT','UPDATE','DELETE')
              and (coalesce(qual,'')||coalesce(with_check,'')) !~ 'site\.email\.manage') then
    raise exception 'Slice 7: an email-brand write policy is not on site.email.manage.';
  end if;
  -- Scoped to the CANONICAL path on purpose. internal.has_site_capability takes the key straight to
  -- capability_decision, so a retired key there is refused at rule 1 and the policy denies everybody.
  -- internal.has_capability is different: it is the deliberate compatibility adapter and TRANSLATES a
  -- legacy key through public.capability_key_map, which is why dozens of pre-existing policies name
  -- keys like `team.view` and `fixture.edit` and work perfectly well. Those retire with the adapter at
  -- Slice 10 and are none of Slice 7's business; flagging them here would be a grep count masquerading
  -- as a finding.
  if exists (
    select 1 from pg_policies p, public.capabilities c
     where p.schemaname in ('public','storage') and c.status <> 'ACTIVE'
       and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,''))
           like '%has_site_capability(''' || c.key || '''%') then
    raise exception 'Slice 7: a policy passes a deprecated capability to has_site_capability, which denies everybody.';
  end if;

  select count(*) into v from pg_policies p
   where p.schemaname in ('public','storage')
     and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) ~ '\m(is_site_admin|is_full_site_admin|is_club_admin)\(';
  if v <> 0 then
    raise exception 'Slice 7: % policies still carry a Site Admin label (PG-15 must be 0).', v;
  end if;
  raise notice 'Slice 7: PG-15 = 0. No RLS policy asks whether somebody is a Site Admin.';
end $$;

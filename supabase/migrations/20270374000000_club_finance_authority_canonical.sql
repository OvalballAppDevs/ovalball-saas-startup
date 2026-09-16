-- =====================================================================================================
-- SLICE 4H (2/3) — FINANCE AND CLUB ADMINISTRATION, OFF THE DEPRECATED KEYS
--
-- Design J.13 (finance and payment administration) and J.4 (clubs), under AA.3 row 4h, whose title is
-- "Club administration and finance".
--
-- Slice 3 catalogued every finance key -- finance.subscription.view/configure, finance.enrolment.manage,
-- finance.payment.act, finance.subscription.export, finance.gocardless.connect,
-- finance.platform_billing.view/manage -- as ACTIVE with exactly the bundles J.13 specifies, and mapped
-- the old club.subscription.* / club.platform_billing.* / club.gocardless.connect keys onto them in
-- capability_key_map. Then nothing moved: twenty-eight functions still ask the deprecated key through
-- the adapter.
--
-- THE FINDING, and it is the reason this file is long. Twenty-six of those twenty-eight open with a
-- bare internal.is_site_admin(). So EVERY site-admin profile -- read_only, content, fixture_ops,
-- message_moderator included -- can today configure a club's subscription prices, exempt a member from
-- an obligation, change who pays, refund a payment, end a subscription, connect or disconnect the
-- club's GoCardless account, and start, pause or cancel the club's plan with Ovalball.
--
-- J.13 does not leave this to inference. The site-master column is EMPTY for every acting key, and the
-- one for finance.payment.act carries the reason in the table itself: "(Site Admins never act on club
-- payments)". The section closes with a hard prohibition -- payment secrets are never accessible during
-- impersonation, and never to any Site Admin profile.
--
-- So the site branch is not re-pointed for those keys. It is REMOVED. Where J.13 does record a site
-- master -- the two platform-billing keys and the finance read, which are Ovalball's own commercial
-- relationship with the club rather than the club's money -- it becomes that master.
-- =====================================================================================================

do $$
declare
  -- legacy key, canonical key, site master ('' means J.13 records none and the site branch goes)
  v_map constant text[][] := array[
    ['club.subscription.view_finance',           'finance.subscription.view',       'site.commercial.view'],
    ['club.subscription.configure',              'finance.subscription.configure',  ''],
    ['club.subscription.manage_enrolment',       'finance.enrolment.manage',        ''],
    ['club.subscription.manage_payment_actions', 'finance.payment.act',             ''],
    ['club.subscription.export',                 'finance.subscription.export',     ''],
    ['club.gocardless.connect',                  'finance.gocardless.connect',      ''],
    ['club.platform_billing.view',               'finance.platform_billing.view',   'site.commercial.view'],
    ['club.platform_billing.manage',             'finance.platform_billing.manage', 'site.commercial.manage'],
    ['club.edit_profile',                        'club.profile.edit',               'site.clubs.profile.manage']
  ];
  r record;
  v_src text;
  v_new text;
  i int;
  v_site text;
  v_touched int := 0;
begin
  for r in
    select p.oid, n.nspname, p.proname, pg_get_functiondef(p.oid) as def, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prosrc ~ '''(club\.(subscription|platform_billing|gocardless|edit_profile)[a-z_.]*)'''
    order by n.nspname, p.proname
  loop
    v_new := r.def;
    v_site := null;

    for i in 1 .. array_length(v_map, 1) loop
      if position(v_map[i][1] in v_new) > 0 then
        -- The adapter already recorded this mapping; the rewrite only stops going through it.
        v_new := replace(v_new,
          'internal.has_capability(''' || v_map[i][1] || ''', ''club'', ',
          'internal.can(''' || v_map[i][2] || ''', ''club'', ');
        v_new := replace(v_new, '''' || v_map[i][1] || '''', '''' || v_map[i][2] || '''');
        -- Where two keys meet in one function the strictest site answer wins, and an empty master
        -- beats a named one: a function that touches payments must not keep a site branch because it
        -- also happens to read a balance.
        if v_map[i][3] = '' then
          v_site := '';
        elsif v_site is null then
          v_site := v_map[i][3];
        end if;
      end if;
    end loop;

    -- internal.can takes five arguments where internal.has_capability took four.
    v_new := regexp_replace(v_new,
      '(internal\.can\(''(?:finance|club)\.[a-z_.]+'', ''club'', [a-zA-Z0-9_\.]+)\)',
      '\1, null, null)', 'g');

    if v_site is not null then
      if v_site = '' then
        v_new := replace(v_new, 'internal.is_site_admin() or ', '');
        v_new := replace(v_new, ' or internal.is_site_admin()', '');
        v_new := replace(v_new, 'internal.is_site_admin()', 'false');
      else
        v_new := replace(v_new, 'internal.is_site_admin()', 'internal.has_site_capability(''' || v_site || ''')');
      end if;
    end if;

    if v_new <> r.def then
      execute v_new;
      v_touched := v_touched + 1;
    end if;
  end loop;

  raise notice 'Slice 4H: % finance and club-administration functions moved off the deprecated keys', v_touched;
end $$;

-- VERIFIED, not assumed. Three separate claims, each checked on the live catalogue rather than on the
-- text of the block above.
do $$
declare v_bad text[];
begin
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and p.prosrc ~ '''club\.(subscription|platform_billing|gocardless|edit_profile)[a-z_.]*''';
  if cardinality(v_bad) > 0 then
    raise exception 'a deprecated finance or club key still has callers: %', array_to_string(v_bad, ', ');
  end if;

  -- No site-admin profile acts on a club's money (J.13, and its hard prohibition).
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and p.prosrc ~ '\mfinance\.(payment\.act|subscription\.(configure|export)|enrolment\.manage|gocardless\.connect)\m'
    and p.prosrc ~ '\mis_site_admin\(';
  if cardinality(v_bad) > 0 then
    raise exception 'a club-money function still carries a Site Admin branch: %', array_to_string(v_bad, ', ');
  end if;

  -- The two platform-billing keys DO have a site master, and it is the recorded one.
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and p.prosrc ~ '\mfinance\.platform_billing\.'
    and p.prosrc ~ '\mis_site_admin\(';
  if cardinality(v_bad) > 0 then
    raise exception 'platform billing still asks the raw site-admin role: %', array_to_string(v_bad, ', ');
  end if;
end $$;

-- One shape for one question ---------------------------------------------------------------------------
-- internal.can's last two arguments default to null, so the rewrite above left some call sites with
-- four arguments and some with five depending on whether the legacy call had passed a trailing null.
-- Both resolve to the same function and mean the same thing; having two spellings in the tree does not.
-- Every retirement grep, every review and every future rewrite reads better against one form.
do $$
declare r record; v_new text; v_touched int := 0;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prosrc ~ 'internal\.can\(''[a-z_.]+'', ''club'', [a-zA-Z0-9_\.]+, null\)'
  loop
    v_new := regexp_replace(r.def,
      '(internal\.can\(''[a-z_.]+'', ''club'', [a-zA-Z0-9_\.]+), null\)',
      '\1, null, null)', 'g');
    if v_new <> r.def then
      execute v_new;
      v_touched := v_touched + 1;
    end if;
  end loop;
  raise notice 'Slice 4H: % call sites normalised to the five-argument form', v_touched;
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public','internal')
               and p.prosrc ~ 'internal\.can\(''[a-z_.]+'', ''club'', [a-zA-Z0-9_\.]+, null\)') then
    raise exception 'a club capability question is still spelled two ways.';
  end if;
end $$;

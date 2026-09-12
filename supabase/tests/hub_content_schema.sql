-- Rugby Hub general-knowledge schema integrity -- permanent regression.
--
-- Pins: the publication lifecycle metadata requirements (reviewed/
-- published/superseded each require their own actor+timestamp, mirroring
-- regulatory_content_sets exactly), the regulatory escape-hatch CHECK
-- constraint, and the uniqueness rules (one shirt number per code, one
-- term+code pair per glossary).
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_id uuid;
  v_raised boolean;
begin
  -- ============ A. DRAFT needs no metadata ============
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hcs-a-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Test title', 'Test summary')
  returning id into v_id;
  raise notice 'PASS (A): DRAFT content item created with no reviewed/published metadata';

  -- ============ B. REVIEWED without any reviewed_by/at is refused ============
  v_raised := false;
  begin
    update public.hub_content_items set status = 'REVIEWED' where id = v_id;
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (B): REVIEWED accepted without reviewed_by/reviewed_at';
  end if;
  raise notice 'PASS (B): REVIEWED refused without reviewed_by/reviewed_at';

  -- ============ B2. REVIEWED with only reviewed_at (no reviewed_by) is refused ============
  v_raised := false;
  begin
    update public.hub_content_items set status = 'REVIEWED', reviewed_at = now() where id = v_id;
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (B2): REVIEWED accepted with reviewed_at but no reviewed_by';
  end if;
  raise notice 'PASS (B2): REVIEWED refused with reviewed_at set but reviewed_by still null';
end $$;

do $$
declare
  v_id uuid;
  v_admin uuid := gen_random_uuid();
  v_raised boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'hcs-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'Hub', 'Admin', 'hcs-admin-' || v_admin::text || '@ovalball.test');

  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hcs-c-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Test title', 'Test summary')
  returning id into v_id;

  -- ============ C. PUBLISHED without published_by/at is refused ============
  update public.hub_content_items set status = 'REVIEWED', reviewed_by = v_admin, reviewed_at = now() where id = v_id;
  v_raised := false;
  begin
    update public.hub_content_items set status = 'PUBLISHED' where id = v_id;
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (C): PUBLISHED accepted without published_by/published_at';
  end if;
  raise notice 'PASS (C): PUBLISHED refused without published_by/published_at';

  -- ============ D. SUPERSEDED without superseded_by is refused ============
  v_raised := false;
  begin
    update public.hub_content_items set status = 'SUPERSEDED' where id = v_id;
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (D): SUPERSEDED accepted without superseded_by';
  end if;
  raise notice 'PASS (D): SUPERSEDED refused without superseded_by';

  -- ============ E. The regulatory escape-hatch CHECK rejects flagrant phrasing ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hcs-e-' || substr(gen_random_uuid()::text,1,8), 'COACHING_GUIDANCE', 'What the RFU requires at training', 'A guide.');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (E): a title containing "the RFU requires" was accepted into general content';
  end if;
  raise notice 'PASS (E): regulatory escape-hatch phrasing refused in general content title';

  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hcs-e2-' || substr(gen_random_uuid()::text,1,8), 'COACHING_GUIDANCE', 'A safe title', 'Players must always warm up before contact.');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (E2): a summary containing "Players must" was accepted';
  end if;
  raise notice 'PASS (E2): regulatory escape-hatch phrasing refused in general content summary';

  -- Ordinary coaching language without the flagged phrasing is unaffected.
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hcs-e3-' || substr(gen_random_uuid()::text,1,8), 'COACHING_GUIDANCE', 'Warming up safely', 'A good warm-up helps players get ready for contact.');
  raise notice 'PASS (E3): ordinary coaching language, without escape-hatch phrasing, is accepted';
end $$;

do $$
declare
  v_p1 uuid; v_p2 uuid;
  v_raised boolean;
begin
  -- ============ F. Union and League never share a shirt number row ============
  -- Shirt number 20 is deliberately outside the real Position Explorer
  -- content's occupied range (Union 1-15, League 1-13, both now permanently
  -- populated) -- picking 2 here would collide with the real Hooker rows
  -- rather than exercising this test's own collision logic.
  insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose, shirt_number)
  values ('hcs-pos-1-' || substr(gen_random_uuid()::text,1,8), 'union', 'Test Hooker', 'FRONT_ROW', 'Test purpose', 20)
  returning id into v_p1;
  -- Same shirt number, same code, must collide.
  v_raised := false;
  begin
    insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose, shirt_number)
    values ('hcs-pos-2-' || substr(gen_random_uuid()::text,1,8), 'union', 'Test Other', 'FRONT_ROW', 'Test purpose', 20);
  exception when unique_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (F): two Union positions were allowed to share shirt number 20';
  end if;
  raise notice 'PASS (F): duplicate shirt number within one code refused';

  -- Same shirt number, DIFFERENT code, must be allowed (codes are isolated).
  insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose, shirt_number)
  values ('hcs-pos-3-' || substr(gen_random_uuid()::text,1,8), 'league', 'Test League Hooker', 'FORWARDS', 'Test purpose', 20)
  returning id into v_p2;
  raise notice 'PASS (F2): the same shirt number is allowed across different codes -- codes are isolated, not shared';
end $$;

do $$
declare
  v_raised boolean;
  v_key text := 'hcs-glos-' || substr(gen_random_uuid()::text,1,8);
  -- A synthetic, never-real display_term (unique per run) rather than a
  -- hardcoded real rugby word -- real seeded Glossary content (e.g. "Ruck")
  -- legitimately occupies its own (display_term, code) pair permanently,
  -- and this test must never collide with genuine content.
  v_display_term text := 'Hcstestglossaryterm' || substr(v_key, -8);
begin
  -- ============ G. Glossary term uniqueness is per (term, code) ============
  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition)
  values (v_key || '-union', v_display_term, 'union', 'A phase of play in Union.');
  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition)
  values (v_key || '-league', v_display_term, 'league', 'A different concept in League.');
  raise notice 'PASS (G): the same term with different rugby_code values coexists as two rows -- code-specific meanings are not collapsed';

  v_raised := false;
  begin
    insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition)
    values (v_key || '-union-dup', v_display_term, 'union', 'A duplicate.');
  exception when unique_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (G2): the same term+code pair was allowed twice';
  end if;
  raise notice 'PASS (G2): duplicate term+code pair refused';
end $$;

rollback;

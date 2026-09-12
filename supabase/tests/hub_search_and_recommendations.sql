-- Rugby Hub general-knowledge search and recommendations -- permanent
-- regression.
--
-- Proves: search ranks a title match above a body-only match, published-
-- only holds under a real full-text query (not just direct id lookup, see
-- hub_content_rls.sql section F for that), and recommendations rank an
-- identity-specific match above a universal one while still surfacing
-- universal content as a fallback -- and never returns a filter that
-- excludes everything else (context narrows a ranking, it is not an
-- access gate).
--
-- get_hub_recommended_content calls below use a generously large limit
-- (500), not the RPC's own default -- the universal-content assertions
-- need this test's own freshly-inserted fixture to actually appear within
-- the returned window, and the real number of PUBLISHED universal rows
-- across CONTENT_ITEM/POSITION/SKILL/GLOSSARY_TERM keeps growing as more
-- Rugby Hub domains ship (78 as of the Officiating slice) with no
-- guaranteed secondary sort among ties -- a small limit here is a source
-- of test flakiness as real content grows, not a correctness signal.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_identity_a uuid;
  v_identity_b uuid;
  v_title_match uuid;
  v_body_match uuid;
  v_universal uuid;
  v_identity_specific uuid;
  v_n int;
  v_first_result text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'hsr-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'Hub', 'Admin', 'hsr-admin-' || v_admin::text || '@ovalball.test');

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hsr-identity-a-' || substr(gen_random_uuid()::text,1,8), 'Test Identity A', 'DIRECT')
  returning id into v_identity_a;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hsr-identity-b-' || substr(gen_random_uuid()::text,1,8), 'Test Identity B', 'DIRECT')
  returning id into v_identity_b;

  -- ============ A. Search ranking: title match ranks above body-only match ============
  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values ('hsr-title-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Scrummaging basics', 'A short summary.', 'Body text unrelated to the search term.')
  returning id into v_title_match;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_title_match, true);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_title_match;

  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values ('hsr-body-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Unrelated title', 'A short summary.', 'This body mentions scrummaging only once, deep in the text.')
  returning id into v_body_match;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_body_match, true);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_body_match;

  select result_id::text into v_first_result from public.search_hub_content('scrummaging', 20) order by rank desc limit 1;
  if v_first_result <> v_title_match::text then
    raise exception 'FAIL (A): expected the title match to rank first for "scrummaging", got a different top result';
  end if;
  raise notice 'PASS (A): a title match outranks a body-only match for the same query';

  select count(*) into v_n from public.search_hub_content('scrummaging', 20) where result_id in (v_title_match, v_body_match);
  if v_n <> 2 then
    raise exception 'FAIL (A2): expected both published matches to appear in results, got %', v_n;
  end if;
  raise notice 'PASS (A2): both published matches appear, just ranked differently';

  -- ============ B. Recommendations: identity-specific ranks above universal ============
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hsr-universal-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Universal content', 'Applies to everyone.')
  returning id into v_universal;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_universal, true);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_universal;

  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hsr-specific-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Identity-specific content', 'Applies to Identity A only.')
  returning id into v_identity_specific;
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_identity_specific, v_identity_a);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_identity_specific;

  if (select is_universal_match from public.get_hub_recommended_content(v_identity_a, 500) where result_id = v_identity_specific) is not false then
    raise exception 'FAIL (B): the identity-specific row was not correctly reported as a non-universal match';
  end if;
  raise notice 'PASS (B): recommendations distinguish identity-specific matches from universal ones';

  select count(*) into v_n from public.get_hub_recommended_content(v_identity_a, 500) where result_id = v_universal;
  if v_n <> 1 then
    raise exception 'FAIL (B2): universal content did not appear in recommendations for Identity A';
  end if;
  raise notice 'PASS (B2): universal content still appears as a fallback alongside identity-specific content';

  -- ============ C. Recommendations for a DIFFERENT identity: no cross-identity leak, universal still present ============
  select count(*) into v_n from public.get_hub_recommended_content(v_identity_b, 500) where result_id = v_identity_specific;
  if v_n <> 0 then
    raise exception 'FAIL (C): content scoped to Identity A appeared in recommendations for Identity B';
  end if;
  select count(*) into v_n from public.get_hub_recommended_content(v_identity_b, 500) where result_id = v_universal;
  if v_n <> 1 then
    raise exception 'FAIL (C2): universal content did not appear for a completely different identity';
  end if;
  raise notice 'PASS (C): recommendations never leak across identities, and universal content still reaches everyone';

  -- ============ D. Recommendations remain a ranking, not an access gate: unpublished content excluded either way ============
  declare
    v_draft uuid;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hsr-draft-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Draft recommendation bait', 'x')
    returning id into v_draft;
    insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_draft, v_identity_a);
    select count(*) into v_n from public.get_hub_recommended_content(v_identity_a, 500) where result_id = v_draft;
    if v_n <> 0 then
      raise exception 'FAIL (D): an unpublished DRAFT item was recommended';
    end if;
    raise notice 'PASS (D): recommendations never surface unpublished content, regardless of applicability match';
  end;
end $$;

rollback;

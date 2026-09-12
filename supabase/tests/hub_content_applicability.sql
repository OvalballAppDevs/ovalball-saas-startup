-- Rugby Hub general-knowledge applicability -- permanent regression.
--
-- Pins the invariant the accepted spec called out as the most dangerous to
-- get wrong: "no applicability row" must NEVER be silently read as
-- universal. UNIVERSAL is a row you write (is_universal = true), not an
-- absence you rely on -- and PUBLISHED is unreachable until at least one
-- applicability row (universal or scoped) exists.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_content uuid;
  v_identity uuid;
  v_raised boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'hca-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'Hub', 'Admin', 'hca-admin-' || v_admin::text || '@ovalball.test');

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hca-identity-' || substr(gen_random_uuid()::text,1,8), 'Test Identity', 'DIRECT')
  returning id into v_identity;

  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hca-a-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Test title', 'Test summary')
  returning id into v_content;

  -- ============ A. Publish is refused with zero applicability rows ============
  v_raised := false;
  begin
    update public.hub_content_items
    set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
    where id = v_content;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (A): content published with ZERO applicability rows -- this would have silently reached everyone';
  end if;
  raise notice 'PASS (A): publish refused with no applicability row -- absence never means universal';

  -- ============ B. An explicit is_universal=true row unblocks publish ============
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_content, true);
  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id = v_content;
  raise notice 'PASS (B): publish succeeds once an EXPLICIT is_universal=true row exists';

  -- ============ C. A universal row cannot also carry a scoping dimension ============
  v_raised := false;
  begin
    insert into public.hub_content_applicability (content_item_id, is_universal, gender_pathway) values (v_content, true, 'MALE');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (C): a row claimed is_universal=true AND carried a scoping dimension';
  end if;
  raise notice 'PASS (C): a universal row cannot also be scoped -- it is pure, or it is not universal';

  -- ============ D. A non-universal row with zero scoping dimensions is refused ============
  v_raised := false;
  begin
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_content, false);
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (D): a non-universal applicability row with no scoping dimension at all was accepted -- it would resolve nothing';
  end if;
  raise notice 'PASS (D): a non-universal row must carry at least one real scoping dimension';

  -- ============ E. Exactly one parent FK is required ============
  v_raised := false;
  begin
    insert into public.hub_content_applicability (content_item_id, position_id, is_universal) values (v_content, gen_random_uuid(), true);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (E): an applicability row with TWO parent FKs set was accepted';
  end if;
  raise notice 'PASS (E): exactly-one-parent constraint refuses two simultaneous parent FKs';

  v_raised := false;
  begin
    insert into public.hub_content_applicability (is_universal) values (true);
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (E2): an applicability row with ZERO parent FKs was accepted';
  end if;
  raise notice 'PASS (E2): exactly-one-parent constraint refuses zero parent FKs too';

  -- ============ F. An identity-scoped row also works, alongside universal ============
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_content, v_identity);
  if (select count(*) from public.hub_content_applicability where content_item_id = v_content) <> 2 then
    raise exception 'FAIL (F): expected exactly 2 applicability rows (universal + identity-scoped)';
  end if;
  raise notice 'PASS (F): a content item can carry both a universal row and an identity-scoped row simultaneously';
end $$;

do $$
declare
  v_pos uuid;
  v_identity uuid;
  v_stage text;
begin
  -- ============ G. Position age-stage: absent row is NOT the same as NORMAL ============
  insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose)
  values ('hca-pos-' || substr(gen_random_uuid()::text,1,8), 'union', 'Test Position', 'BACKS', 'Test purpose')
  returning id into v_pos;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hca-identity-2-' || substr(gen_random_uuid()::text,1,8), 'Test Identity 2', 'DIRECT')
  returning id into v_identity;

  select stage into v_stage from public.hub_position_age_stage where position_id = v_pos and regulatory_identity_id = v_identity;
  if v_stage is not null then
    raise exception 'FAIL (G): expected no age-stage row yet';
  end if;
  raise notice 'PASS (G): with no hub_position_age_stage row, there is no stage -- a resolver must treat this as "not yet assessed", never as NORMAL';

  insert into public.hub_position_age_stage (position_id, regulatory_identity_id, stage, stage_note)
  values (v_pos, v_identity, 'NOT_APPLICABLE', 'Fixed positional specialisation is not appropriate at this age grade.');
  raise notice 'PASS (G2): NOT_APPLICABLE is a valid, explicit, storable state';

  -- ============ H. A non-NORMAL stage requires a note ============
  declare
    v_raised boolean := false;
    v_identity_3 uuid;
  begin
    insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
    values ('union', 'hca-identity-3-' || substr(gen_random_uuid()::text,1,8), 'Test Identity 3', 'DIRECT')
    returning id into v_identity_3;
    begin
      insert into public.hub_position_age_stage (position_id, regulatory_identity_id, stage)
      values (v_pos, v_identity_3, 'EMERGING');
    exception when check_violation then
      v_raised := true;
    end;
    if not v_raised then
      raise exception 'FAIL (H): EMERGING accepted without a stage_note';
    end if;
    raise notice 'PASS (H): EMERGING/NOT_APPLICABLE both require a stage_note -- NORMAL is the only stage that does not';
  end;
end $$;

rollback;

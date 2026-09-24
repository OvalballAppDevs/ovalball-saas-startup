-- THE RULES OF PLAY REACH THE PLATFORM (RH-M0.2) -- permanent regression.
--
-- Pins: the canonical Rules-of-Play read answers from regulatory_fact_applicability for the
-- identity a team's canonical type maps to -- never from a team name or an age number; a fact
-- already shown as a General Law through a published RULES content set is never listed twice; two
-- teams of different age grades in the same code get DIFFERENT answers (the RH-M0.1 finding);
-- a NO_DIRECT_MAPPING or unmapped team gets nothing; authorisation is the same relationship test
-- the existing Rules read uses (a guardian of a member may read, a stranger is refused); code
-- isolation holds; the browse-by-identity form answers the same rows; and every currently
-- effective applicable RULES fact has a search destination that names an identity and a section.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir uuid; v_club uuid;
  v_team_u8 uuid; v_team_u12 uuid;
  v_player_u8 uuid; v_player_u12 uuid;
  v_id_u8 uuid; v_id_u12 uuid;
  v_n int; v_m int; v_k int;
  v_err text;
  v_code text;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_admin,    'rop-admin@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_guardian, 'rop-guardian@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_stranger, 'rop-stranger@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Rules Of Play Club', 'union', 'England', 'England', 'manual', 'verified', 'rules-of-play-club') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'rules-of-play-club', 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');

  -- Two sides, two age grades, one code. The trigger resolves each canonical type; the identity
  -- is then whatever the register maps that type to -- the test never names an age itself.
  insert into public.teams (club_id, rugby_code, display_name, slug, category, age_group, gender, active)
  values (v_club, 'union', 'Under 8 Mixed', 'u8-rop', 'youth', 'U8', 'mixed', true) returning id into v_team_u8;
  insert into public.teams (club_id, rugby_code, display_name, slug, category, age_group, gender, active)
  values (v_club, 'union', 'Under 12 Boys', 'u12-rop', 'youth', 'U12', 'boys', true) returning id into v_team_u12;

  insert into public.players (first_name, surname, date_of_birth, created_by)
  values ('Rop', 'Younger', current_date - interval '7 years', v_admin) returning id into v_player_u8;
  insert into public.players (first_name, surname, date_of_birth, created_by, playing_pathway)
  values ('Rop', 'Older', current_date - interval '11 years', v_admin, 'MALE') returning id into v_player_u12;
  insert into public.guardians (guardian_user_id, player_id, status) values (v_guardian, v_player_u8, 'active'), (v_guardian, v_player_u12, 'active');
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player_u8, v_team_u8, 'active'), (v_player_u12, v_team_u12, 'active');

  -- regulatory_context_for_team authorises the caller: resolve the identities as the club admin.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select rc.regulatory_identity_id into v_id_u8 from internal.regulatory_context_for_team(v_team_u8) rc;
  select rc.regulatory_identity_id into v_id_u12 from internal.regulatory_context_for_team(v_team_u12) rc;
  if v_id_u8 is null or v_id_u12 is null or v_id_u8 = v_id_u12 then
    raise notice 'FAIL 0: the two sides did not resolve to two regulatory identities (% / %)', v_id_u8, v_id_u12;
  else
    raise notice 'PASS 0: two sides, two regulatory identities';
  end if;

  -- 1. the canonical read answers per identity, and the two age grades differ
  select count(*) into v_n from internal.resolve_age_grade_rules_of_play('union', v_id_u8, current_date, null::text);
  select count(*) into v_m from internal.resolve_age_grade_rules_of_play('union', v_id_u12, current_date, null::text);
  select count(*) into v_k
  from internal.resolve_age_grade_rules_of_play('union', v_id_u8, current_date, null::text) a
  join internal.resolve_age_grade_rules_of_play('union', v_id_u12, current_date, null::text) b on b.fact_id = a.fact_id;
  if v_n > 0 and v_m > 0 and v_k < least(v_n, v_m) then
    raise notice 'PASS 1: Rules of Play differ by age grade (younger %, older %, shared %)', v_n, v_m, v_k;
  else
    raise notice 'FAIL 1: Rules of Play do not differ by age grade (younger %, older %, shared %)', v_n, v_m, v_k;
  end if;

  -- 2. never the same fact twice: nothing a Rule of Play lists is also in the General Law bundle
  select count(*) into v_k
  from internal.resolve_age_grade_rules_of_play('union', v_id_u8, current_date, null::text) rp
  join internal.resolve_age_grade_rule_bundle('union', v_id_u8, current_date, null) gl on gl.fact_id = rp.fact_id;
  if v_k = 0 then raise notice 'PASS 2: no fact is both a General Law and a Rule of Play';
  else raise notice 'FAIL 2: % facts listed twice', v_k; end if;

  -- 3. every row carries a category section, a governing-body value and a source
  select count(*) filter (where section_key is null or section_key = '')
       + count(*) filter (where primary_source_key is null)
       + count(*) filter (where obligation_level is null)
    into v_k
  from internal.resolve_age_grade_rules_of_play('union', v_id_u8, current_date, null::text);
  if v_k = 0 then raise notice 'PASS 3: every Rule of Play has a section, an obligation level and a primary source';
  else raise notice 'FAIL 3: % rows missing section/obligation/source', v_k; end if;
  select count(distinct section_key) into v_k from internal.resolve_age_grade_rules_of_play('union', v_id_u8, current_date, null::text);
  if v_k >= 5 then raise notice 'PASS 3b: the younger side''s rules span % categories', v_k;
  else raise notice 'FAIL 3b: only % categories', v_k; end if;

  -- 4. code isolation: the identity refuses the other code
  begin
    perform * from internal.resolve_age_grade_rules_of_play('league', v_id_u8, current_date, null::text);
    raise notice 'FAIL 4: a union identity answered for league';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%does not belong to the given rugby code%' then raise notice 'PASS 4: a union identity refuses to answer for league';
    else raise notice 'FAIL 4: refused for the wrong reason -- %', v_err; end if;
  end;

  -- 5. the public reader answers the guardian for their own child's team, with the identity named
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  select count(*), min(identity_key), min(identity_rugby_code) into v_k, v_err, v_code from public.get_rugby_hub_rules_of_play(v_team_u8);
  if v_k = v_n and v_err is not null then raise notice 'PASS 5: the guardian reads % Rules of Play for % (%)', v_k, v_err, v_code;
  else raise notice 'FAIL 5: guardian read % rows (expected %), identity %', v_k, v_n, v_err; end if;

  -- 6. the same reader is silent -- refused -- for a stranger
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    select count(*) into v_k from public.get_rugby_hub_rules_of_play(v_team_u8);
    raise notice 'FAIL 6: a stranger read % rows', v_k;
  exception when others then
    get stacked diagnostics v_err = RETURNED_SQLSTATE;
    if v_err = '42501' then raise notice 'PASS 6: a stranger is refused (42501)';
    else raise notice 'FAIL 6: refused with % rather than 42501', v_err; end if;
  end;

  -- 7. browse by identity answers the same rows as the team read (whoever is looking)
  select count(*) into v_k
  from public.get_rugby_hub_rules_of_play_by_identity((select identity_key from public.regulatory_identities where id = v_id_u8)) b
  join internal.resolve_age_grade_rules_of_play('union', v_id_u8, current_date, null::text) a on a.fact_id = b.fact_id;
  if v_k = v_n then raise notice 'PASS 7: browse-by-identity answers the same % rows', v_k;
  else raise notice 'FAIL 7: browse-by-identity answered % of % rows', v_k, v_n; end if;
  select count(*) into v_k from public.get_rugby_hub_rules_of_play_by_identity('NOT-AN-IDENTITY');
  if v_k = 0 then raise notice 'PASS 7b: an unknown identity is silent';
  else raise notice 'FAIL 7b: unknown identity returned % rows', v_k; end if;

  -- 8. the club admin (team.team.view) reads too -- and a side with no direct mapping gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_k from public.get_rugby_hub_rules_of_play(v_team_u12);
  if v_k = v_m then raise notice 'PASS 8: the club admin reads the older side''s % rules', v_k;
  else raise notice 'FAIL 8: club admin read % (expected %)', v_k, v_m; end if;

  -- 9. anon holds no grant on any of it
  if has_function_privilege('anon', 'public.get_rugby_hub_rules_of_play(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_rugby_hub_rules_of_play_by_identity(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_regulatory_fact_search_context(uuid[], uuid)', 'EXECUTE') then
    raise notice 'FAIL 9: anon can execute a Rules of Play reader';
  else
    raise notice 'PASS 9: anon cannot execute any Rules of Play reader';
  end if;

  -- 10. search: every currently-effective applicable RULES fact has a destination, and the viewer's
  --     own identity wins when a fact applies to several
  select count(*) into v_k
  from public.regulatory_facts f
  cross join lateral internal.regulatory_fact_primary_occurrence(f.id) oc
  where f.status = 'VERIFIED' and f.topic = 'RULES'
    and (f.effective_from is null or f.effective_from <= current_date)
    and (f.effective_to is null or f.effective_to >= current_date)
    and exists (select 1 from public.regulatory_fact_applicability fa where fa.fact_id = f.id and fa.competition_overlay_id is null)
    and (oc.destination_kind is null or (oc.destination_kind = 'RULES_PAGE' and (oc.identity_key is null or oc.section_key is null)));
  if v_k = 0 then raise notice 'PASS 10: no orphan Rules search result';
  else raise notice 'FAIL 10: % RULES facts have no usable destination', v_k; end if;

  select oc.identity_key into v_err
  from internal.resolve_age_grade_rules_of_play('union', v_id_u12, current_date, null::text) rp
  cross join lateral internal.regulatory_fact_primary_occurrence(rp.fact_id, v_id_u12) oc
  where rp.applies_to_count > 1
  limit 1;
  if v_err = (select identity_key from public.regulatory_identities where id = v_id_u12) then
    raise notice 'PASS 10b: a shared fact resolves to the viewer''s own identity (%)', v_err;
  else
    raise notice 'FAIL 10b: a shared fact resolved to % rather than the viewer''s identity', v_err;
  end if;

  -- Every Rule of Play the viewer sees has a destination; a skill page outranks the Rules page
  -- (a contact rule taught through a skill lands there), and every Rules-page destination names
  -- the viewer's own identity.
  select count(*) filter (where c.destination_kind is null)
       + count(*) filter (where c.destination_kind = 'RULES_PAGE' and c.identity_key is distinct from (select identity_key from public.regulatory_identities where id = v_id_u8))
    into v_k
  from public.get_regulatory_fact_search_context(
    (select array_agg(fact_id) from internal.resolve_age_grade_rules_of_play('union', v_id_u8, current_date, null::text)), v_id_u8) c;
  if v_k = 0 then raise notice 'PASS 10c: every Rule of Play has a destination, and every Rules-page destination is the viewer''s own identity';
  else raise notice 'FAIL 10c: % facts orphaned or sent to another identity', v_k; end if;

  -- 10d. a Rule of Play stated as a MEASURE is findable, and the viewer's copy is the one that resolves
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  select count(*) into v_k
  from public.search_hub_content('ball size', 30) s
  join public.get_regulatory_fact_search_context(array[s.result_id], v_id_u8) c on c.fact_id = s.result_id
  where s.result_type = 'RULE' and c.destination_kind = 'RULES_PAGE' and c.section_key = 'BALL_SIZE'
    and c.identity_key = (select identity_key from public.regulatory_identities where id = v_id_u8);
  if v_k >= 1 then raise notice 'PASS 10d: "ball size" finds the Rule of Play and resolves it to the viewer''s own age grade';
  else raise notice 'FAIL 10d: "ball size" did not resolve to the viewer''s Ball rule'; end if;
end $$;

rollback;

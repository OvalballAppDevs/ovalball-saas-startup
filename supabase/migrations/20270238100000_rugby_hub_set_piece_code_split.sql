-- Rugby Hub set-piece code split.
--
-- set-piece-technique was published with a summary that conflates Rugby
-- Union scrum/lineout technique with Rugby League play-the-ball/restart
-- technique, and was deliberately left with no teaching content for
-- exactly that reason (see RUGBY HUB SET-PIECE CODE SPLIT -- ARCHAEOLOGY
-- + MIGRATION PLAN, approved). This migration retires it in favour of two
-- genuine, code-specific canonical skills, reusing the existing knowledge
-- graph -- no new table, no second Skills Explorer.
--
-- rugby_code is added to hub_skills (nullable, mirroring
-- hub_positions.rugby_code) because neither hub_skills nor
-- hub_content_applicability previously had any way to say "this identity
-- belongs to one code". is_universal on hub_content_applicability means
-- "applies to literally every viewer" -- a different, and for these two
-- skills false, statement. Applicability for these two skills is
-- therefore NOT is_universal=true: it is one row per real
-- regulatory_identity of the matching code (19 Union identities, 16
-- League identities) -- the only honest way the existing applicability
-- schema can express "this applies broadly within one code" without a
-- second schema change. This does not affect browsing or search, which
-- read PUBLISHED status only and stay open to everyone regardless of
-- code -- applicability here only ever affects recommendation ranking and
-- the publish gate.

alter table public.hub_skills add column if not exists rugby_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hub_skills_rugby_code_check') then
    alter table public.hub_skills add constraint hub_skills_rugby_code_check check (rugby_code is null or rugby_code = any (array['union', 'league']));
  end if;
end $$;

comment on column public.hub_skills.rugby_code is 'NULL = genuinely code-universal skill (the default, and the common case). ''union''/''league'' only when a skill genuinely does not exist in the other code — e.g. scrum-and-lineout-technique vs play-the-ball-and-restart. Mirrors hub_positions.rugby_code; never inferred from skill_key in React.';

do $$
declare
  v_actor uuid;
  v_legacy uuid;
  v_scrum uuid;
  v_ptb uuid;
  v_content_scrum uuid;
  v_fact uuid;
begin
  select id into v_actor from auth.users where email = 'rugby-hub-content-import@system.ovalball.internal';
  if v_actor is null then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'rugby-hub-content-import@system.ovalball.internal', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    ) returning id into v_actor;
  end if;

  select id into v_legacy from public.hub_skills where skill_key = 'set-piece-technique';

  -- =====================================================================
  -- UNION: Scrum and Lineout Technique
  -- =====================================================================
  select id into v_scrum from public.hub_skills where skill_key = 'scrum-and-lineout-technique';
  if v_scrum is null then
    insert into public.hub_skills (
      skill_key, display_name, skill_family, rugby_code, summary,
      why_it_matters, when_you_use_it, key_cues, common_mistakes, how_to_improve, game_examples, technique_steps
    ) values (
      'scrum-and-lineout-technique', 'Scrum and Lineout Technique', 'SET_PIECE', 'union',
      'The specific technical work of set-piece play — binding, engaging and driving in the scrum, and calling, lifting and jumping at the lineout — practised on its own before it shows up in a match.',
      'A stable scrum and a clean lineout win your team the ball without a contest happening anywhere else on the pitch, and every attacking phase that follows starts from good ball here.',
      'At every scrum and every lineout — how contested each one is changes by age grade, but the technique itself is the same skill throughout.',
      'Bind tight and square before you engage; keep your hips low and your back straight through the drive; call a lineout jump early and commit to it.',
      'Standing up too early under scrum pressure instead of driving through the hips; a lineout jumper leaving the call too late to be lifted cleanly.',
      'Build scrum body position and lineout timing progressively with a qualified coach — uncontested repetition first, with real contest added only as your age grade''s own rules introduce it.',
      'A front row holding its own scrum and giving quick, stable ball to the scrum-half under real pressure; a lineout jumper winning contested ball at the exact height and timing the throw was called for.',
      '[{"label": "Bind and engage", "text": "Get into a strong, square body position and bind onto your team-mates before you engage — never anticipate the referee''s call to come together."}, {"label": "Drive", "text": "Push forward together with your hips low and your back straight, keeping the scrum square and travelling in a straight line rather than wheeling it round."}, {"label": "Deliver", "text": "Once the ball has emerged, stay bound and square until the scrum-half has it clear, then release together into the next phase."}]'::jsonb
    ) returning id into v_scrum;
  end if;

  -- =====================================================================
  -- LEAGUE: Play-the-Ball and Restart
  -- =====================================================================
  select id into v_ptb from public.hub_skills where skill_key = 'play-the-ball-and-restart';
  if v_ptb is null then
    insert into public.hub_skills (
      skill_key, display_name, skill_family, rugby_code, summary,
      why_it_matters, when_you_use_it, key_cues, common_mistakes, how_to_improve, game_examples, technique_steps
    ) values (
      'play-the-ball-and-restart', 'Play-the-Ball and Restart', 'SET_PIECE', 'league',
      'Getting back to your feet and playing the ball cleanly after a tackle, and getting a restart or kick-off away accurately under pressure — Rugby League''s own way of restarting play after contact, with no ruck, maul or scrum involved.',
      'A fast, clean play-the-ball keeps your team''s attack moving and denies the defence time to reset their line; a well-executed restart puts your team on the front foot the moment the ball is back in play.',
      'Every time you''re tackled with the ball in hand, and at every kick-off or line drop-out.',
      'Get straight back to your feet facing your opponents'' try line; place the ball between your feet and play it backwards with your foot in one controlled motion, without delay.',
      'Getting up awkwardly and slowing your own play-the-ball down; rushing a restart kick without checking your own line is far enough back to be onside.',
      'Practise the tackle-to-feet-to-play-the-ball sequence repeatedly until it needs no thought, and drill restart kicks for both length and accuracy under fatigue.',
      'A quick play-the-ball that beats the defensive line back onside before it can reset; a chip restart that pins the receiving team deep in their own half.',
      '[{"label": "Get up", "text": "Get back to your feet quickly after the tackle, on the spot where you were held, facing your opponents'' try line."}, {"label": "Play it", "text": "Place the ball on the ground between your feet and play it backwards with your foot in one controlled motion — never by hand, and without delay."}, {"label": "Clear", "text": "Move away from the play-the-ball immediately so the acting half-back has a clear pass, and rejoin your attacking or defensive line."}]'::jsonb
    ) returning id into v_ptb;
  end if;

  -- =====================================================================
  -- Applicability: NOT is_universal (section 4 correction). One row per
  -- real regulatory_identity of the matching code -- the only honest way
  -- the existing schema can say "applies broadly within one code" without
  -- inventing a second schema change. Browsing/search are unaffected;
  -- this only shapes get_hub_recommended_content's ranking and satisfies
  -- the publish gate.
  -- =====================================================================
  insert into public.hub_content_applicability (skill_id, regulatory_identity_id)
  select v_scrum, ri.id from public.regulatory_identities ri
  where ri.rugby_code = 'union'
    and not exists (select 1 from public.hub_content_applicability a where a.skill_id = v_scrum and a.regulatory_identity_id = ri.id);

  insert into public.hub_content_applicability (skill_id, regulatory_identity_id)
  select v_ptb, ri.id from public.regulatory_identities ri
  where ri.rugby_code = 'league'
    and not exists (select 1 from public.hub_content_applicability a where a.skill_id = v_ptb and a.regulatory_identity_id = ri.id);

  update public.hub_skills set status = 'REVIEWED', reviewed_by = v_actor, reviewed_at = now() where id in (v_scrum, v_ptb) and status = 'DRAFT';
  update public.hub_skills set status = 'PUBLISHED', published_by = v_actor, published_at = now() where id in (v_scrum, v_ptb) and status = 'REVIEWED';

  -- =====================================================================
  -- Legacy identity: retire via the existing (previously unused)
  -- superseded_by column, pointed at the Union successor -- all 5
  -- existing position relationships were Union, and its historical
  -- meaning sits closest to scrum/lineout, not play-the-ball.
  -- =====================================================================
  if v_legacy is not null then
    update public.hub_skills set status = 'SUPERSEDED', superseded_by = v_scrum where id = v_legacy and status <> 'SUPERSEDED';
    delete from public.hub_content_applicability where skill_id = v_legacy;
  end if;

  -- =====================================================================
  -- Position relationships: audited individually, not copied
  -- mechanically. Re-point the 5 real Union front-five links; add exactly
  -- one League link where a genuine specialist relationship exists (the
  -- dummy-half is the position most defined by play-the-ball pickup
  -- speed) -- never every League position, since every tackled
  -- ball-carrier playing the ball is universal participation, not a
  -- position-defining relationship.
  -- =====================================================================
  if v_legacy is not null then
    delete from public.hub_position_skills where skill_id = v_legacy;
  end if;

  insert into public.hub_position_skills (position_id, skill_id)
  select p.id, v_scrum from public.hub_positions p
  where p.position_key in ('union-loosehead-prop', 'union-hooker', 'union-tighthead-prop', 'union-lock-four', 'union-lock-five')
  on conflict do nothing;

  insert into public.hub_position_skills (position_id, skill_id)
  select p.id, v_ptb from public.hub_positions p
  where p.position_key = 'league-hooker'
  on conflict do nothing;

  -- =====================================================================
  -- Union regulatory content: real, VERIFIED RFU-REG15 scrum/lineout
  -- age-progression facts, surfaced through the existing generic
  -- skill-content-regulatory pipeline (hub_skill_content_links +
  -- hub_regulatory_fact_references + get_hub_skill_content_regulatory_facts)
  -- -- no new resolver. The content item itself is marked is_universal,
  -- consistent with the existing tackling-technique content item: reading
  -- about when Union introduces contested scrums is legitimate general
  -- knowledge for any Rugby Hub visitor, even though the skill it
  -- illustrates is Union-specific.
  -- =====================================================================
  select id into v_content_scrum from public.hub_content_items where content_key = 'how-scrums-and-lineouts-change-by-age';
  if v_content_scrum is null then
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values (
      'how-scrums-and-lineouts-change-by-age', 'COACHING_GUIDANCE', 'How scrums and lineouts change by age',
      'Scrums and lineouts are introduced gradually and become fully contested only once players are old enough — this links directly to the governing body''s own age-grade rules, not an Ovalball estimate.'
    ) returning id into v_content_scrum;

    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_content_scrum, true);

    insert into public.hub_skill_content_links (skill_id, content_item_id) values (v_scrum, v_content_scrum);

    update public.hub_content_items set status = 'REVIEWED', reviewed_by = v_actor, reviewed_at = now() where id = v_content_scrum;
    update public.hub_content_items set status = 'PUBLISHED', published_by = v_actor, published_at = now() where id = v_content_scrum;

    for v_fact in
      select id from public.regulatory_facts
      where fact_key in (
        'RFU-REG15-APP-U7-SCRUM', 'RFU-REG15-APP-U8-SCRUM', 'RFU-REG15-APP-U9-SCRUM',
        'RFU-REG15-APP-U10-SCRUM', 'RFU-REG15-APP-U11-SCRUM', 'RFU-REG15-APP-U12-SCRUM',
        'RFU-REG15-APP-U13-SCRUM', 'RFU-REG15-APP-U14-SCRUM', 'RFU-REG15-APP-U15-BOYS-SCRUM',
        'RFU-REG15-APP-U7-U13-LINEOUT', 'RFU-REG15-APP-U14-LINEOUT', 'RFU-REG15-APP-U15-LINEOUT'
      )
    loop
      insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type)
      values (v_fact, v_content_scrum, 'RULE_EXPLANATION');
    end loop;
  end if;

  -- =====================================================================
  -- League: no equivalent content item. Archaeology confirmed the
  -- regulatory bank has no RFL fact for play-the-ball mechanics, tackle
  -- count, dummy-half mechanics or an age-graded introduction --
  -- deliberately not fabricated here. play-the-ball-and-restart's page
  -- therefore shows no "Sources" section; its footer disclaimer ("general
  -- coaching convention, not law or regulation") is the only provenance
  -- statement it needs.
  -- =====================================================================

end $$;

-- hub_skills_public_read is PUBLISHED-only, so an ordinary viewer's direct
-- select on the now-SUPERSEDED set-piece-technique row returns nothing --
-- there is no way for its old route to learn a successor exists without
-- this narrow resolver. Mirrors the existing get_hub_regulatory_fact_applies
-- / get_hub_skill_content_regulatory_facts pattern: one specific question,
-- answered from inside a SECURITY DEFINER function, never a general bypass
-- of the RLS policy.
create or replace function public.get_hub_superseded_skill_redirect(p_skill_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s2.skill_key
  from public.hub_skills s1
  join public.hub_skills s2 on s2.id = s1.superseded_by
  where s1.skill_key = p_skill_key and s1.status = 'SUPERSEDED' and s2.status = 'PUBLISHED';
$$;
comment on function public.get_hub_superseded_skill_redirect is 'Resolves a retired hub_skills identity''s successor skill_key via superseded_by, for a deterministic redirect on its old route. hub_skills_public_read is PUBLISHED-only, so this is the only way an ordinary viewer can learn a SUPERSEDED skill exists. Returns null for any key that is not genuinely SUPERSEDED with a PUBLISHED successor -- never enumerable, never exposes any other field of the retired row.';

revoke all on function public.get_hub_superseded_skill_redirect(text) from public, anon;
grant execute on function public.get_hub_superseded_skill_redirect(text) to authenticated;

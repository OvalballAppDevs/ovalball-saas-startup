-- Rugby League age-grade regulatory content, from the RFL's own 2026
-- Community Game Operational Rules.
--
-- SOURCE
--
-- RFL Operational Rules 2026 for Tiers Three and Four (Community Game),
-- retrieved directly from rugby-league.com -- which, unlike englandrugby.com,
-- serves its documents to ordinary requests. 240 pages, SHA-256
-- ee3112f4fea7ecde6e4b2d8ee49fde25162590ecec20d1f606bf7ccfb9d37a47, full text
-- layer. This is first-party governing material, not a summary.
--
-- THE FINDING THAT MATTERS MOST
--
-- Rule B2:2:2 sets ball sizes and does NOT set them by age alone:
--
--   Mixed   Size 3   Under 7 to Under 11 (Year 1-6)
--   Male    Size 4   Under 12 to Under 13 (Year 7-8)
--           Size 5   Under 14 and above (Year 9 and above)
--   Female  Size 4   Under 12 to Under 18 (Year 7-13)
--           Size 5   Under-19 and Open Age
--
-- So a female Under 14 plays with a size 4 ball while a male Under 14 plays
-- with a size 5. "Girls follow the same age-grade framework as the boys" is
-- true of the framework and false of this value, and the RFL's published
-- variation wins. The girls identities therefore share the male duration
-- facts -- B2:1:2 sets duration by age group with no sex split -- and take
-- their OWN ball-size fact from U14 upward.
--
-- That asymmetry is the whole reason values are extracted per identity rather
-- than assumed to follow the boys.
--
-- WHAT IS NOT HERE
--
-- Tackle height, sin bin duration, substitutions and extra time are NOT in
-- this document. B2:1:3 lists them as approved variations and says they "are
-- summarised in the RFL Rules Overview Table, which is the authoritative
-- reference for match conditions" -- a table this repository does not have.
-- Those fields are left unpopulated rather than guessed or borrowed from
-- union, and are reported as the outstanding League acquisition.

do $$
declare
  v_importer uuid;
  v_auth uuid;
  v_src uuid;
  v_fact uuid;
  r record;
begin
  select id into v_importer from auth.users where email = 'regulatory-content-import@ovalball.internal';
  select id into v_auth from public.regulatory_authorities where code = 'RFL';
  if v_importer is null or v_auth is null then raise exception 'Importer or RFL authority missing.'; end if;

  -- ============================================================
  -- 1. The source.
  -- ============================================================
  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, landing_page_url, document_version, retrieved_on, effective_from,
    review_state, notes, provenance_notes
  ) values (
    'RFL-CGOR-2026-FULL', v_auth, 'league',
    'RFL Operational Rules 2026 for Tiers Three and Four (Community Game)',
    'REGULATION', 'PRIMARY_REGULATION',
    'https://www.rugby-league.com/uploads/docs/Community%20Game%20Operational%20Rules%202026_Final.pdf',
    'https://www.rugby-league.com/governance/rules-and-regulations/operational-rules',
    '2026 season', date '2026-09-07', date '2026-01-01', 'VERIFIED_CURRENT',
    'The RFL''s national community-game rules. Carries match durations by age group (B2:1:2), approved ball sizes including the male/female split (B2:2:2), the 2026 age ranges with exact date-of-birth windows (Section F13), the Primary Rugby League rules (Section F10) and the Player Dispensation Policy (Section F14).',
    'Retrieved by ordinary public HTTPS GET from the RFL''s own host on 2026-09-07 -- no authentication, no evasion, and none needed: rugby-league.com serves its documents normally. 240 pages, 4442369 bytes, SHA-256 ee3112f4fea7ecde6e4b2d8ee49fde25162590ecec20d1f606bf7ccfb9d37a47, full text layer so extraction is machine-readable. Copy kept in research-ingestion/rfl/ (gitignored). This is the strongest provenance of any source in the Rugby Hub: first-party, directly retrieved, byte-verifiable, and re-fetchable at will.'
  )
  on conflict (source_key) do update set
    notes = excluded.notes, provenance_notes = excluded.provenance_notes,
    review_state = excluded.review_state, updated_at = now();
  select id into v_src from public.regulatory_sources where source_key = 'RFL-CGOR-2026-FULL';

  -- ============================================================
  -- 2. Regulatory identities for the League age grades.
  -- ============================================================
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, ovalball_canonical_team_type_id, mapping_notes, source_register_reference)
  select 'league', v.identity_key, v.label, 'DIRECT', ctt.id, v.notes, 'RFL Operational Rules 2026 (Community Game), Sections B2 and F13'
  from (values
    ('RFL-U12','RFL Under 12s (Year 7)','u12','Male age grade. Year 7.'),
    ('RFL-U13','RFL Under 13s (Year 8)','u13','Male age grade. Year 8.'),
    ('RFL-U14','RFL Under 14s (Year 9)','u14','Male age grade. Year 9. First grade at which the male ball size becomes 5.'),
    ('RFL-U15','RFL Under 15s (Year 10)','u15','Male age grade. Year 10.'),
    ('RFL-U16','RFL Under 16s (Year 11)','u16','Male age grade. Year 11. A player who has turned 16 may also play U17/U18 where their own age group can still fulfil its fixtures (C2:7:7).'),
    ('RFL-U17','RFL Under 17s (Year 12)','u17','Male age grade. Year 12. League''s later-youth stage; the Union analogue is Junior Colts, which is a different operational identity.'),
    ('RFL-U18','RFL Under 18s (Year 13)','u18','Male age grade. Year 13. The Union analogue is Senior Colts, which is a different operational identity.'),
    ('RFL-U19','RFL Under 19s','u19','Above school age. Ball size 5 for both sexes from U19.'),
    ('RFL-OPEN-AGE','RFL Open Age','mens_open_age','Senior male. Eligibility from the 17th birthday, or as a true-age Under 17 from the March in a Season (C2:5:1).'),
    ('RFL-GIRLS-U13','RFL Girls Rugby League, Under 13','girls_u13','Female age grade. Ball size 4 (B2:2:2 female band U12-U18).'),
    ('RFL-GIRLS-U14','RFL Girls Rugby League, Under 14','girls_u14','Female age grade. Ball size 4 -- the male U14 grade uses size 5, so this identity must not share the male ball-size fact.'),
    ('RFL-GIRLS-U15','RFL Girls Rugby League, Under 15','girls_u15','Female age grade. Ball size 4.'),
    ('RFL-GIRLS-U16','RFL Girls Rugby League, Under 16','girls_u16','Female age grade. Ball size 4.'),
    ('RFL-GIRLS-U18','RFL Girls Rugby League, Under 18','girls_u18','Female age grade. Ball size 4 -- the female size 5 band starts at U19.')
  ) as v(identity_key, label, team_type_key, notes)
  join public.canonical_team_types ctt on ctt.key = v.team_type_key
  on conflict (identity_key) do nothing;

  -- Attach each League identity to its canonical team type.
  update public.regulatory_team_type_mappings m
  set mapping_state = 'MAPPED', regulatory_identity_id = ri.id, notes = null, updated_at = now()
  from public.canonical_team_types ctt, public.regulatory_identities ri
  where m.canonical_team_type_id = ctt.id and m.rugby_code = 'league'
    and ri.rugby_code = 'league' and ri.ovalball_canonical_team_type_id = ctt.id
    and m.mapping_state <> 'NOT_OFFERED';

  -- ============================================================
  -- 3. The facts.
  -- ============================================================
  for r in
    select * from (values

    -- ---- Match duration (B2:1:2). Set by AGE GROUP with no sex split, so
    --      the girls identities share these rows.
    ('DURATION-U12','MATCH_DURATION','DURATION',null,40,
     'Two equal halves, with a minimum interval of five minutes between them. RFL Operational Rules 2026 B2:1:2.',
     '{RFL-U12,RFL-GIRLS-U12}'),
    ('DURATION-U13','MATCH_DURATION','DURATION',null,50,
     'Two equal halves. B2:1:2 groups Under 13 and Under 14 at the same duration.',
     '{RFL-U13,RFL-GIRLS-U13}'),
    ('DURATION-U14','MATCH_DURATION','DURATION',null,50,
     'Two equal halves. B2:1:2.',
     '{RFL-U14,RFL-GIRLS-U14}'),
    ('DURATION-U15','MATCH_DURATION','DURATION',null,60,
     'Two equal halves. B2:1:2 groups Under 15 and Under 16 at the same duration.',
     '{RFL-U15,RFL-GIRLS-U15}'),
    ('DURATION-U16','MATCH_DURATION','DURATION',null,60,
     'Two equal halves. B2:1:2.',
     '{RFL-U16,RFL-GIRLS-U16}'),
    ('DURATION-U17','MATCH_DURATION','DURATION',null,70,
     'Two equal halves. B2:1:2.',
     '{RFL-U17}'),
    ('DURATION-U18','MATCH_DURATION','DURATION',null,70,
     'Two equal halves. B2:1:2.',
     '{RFL-U18,RFL-GIRLS-U18}'),
    ('DURATION-U19','MATCH_DURATION','DURATION',null,70,
     'Two equal halves. B2:1:2.',
     '{RFL-U19}'),
    ('DURATION-OPEN-AGE','MATCH_DURATION','DURATION',null,80,
     'Two equal halves. B2:1:2 lists this as "Adult".',
     '{RFL-OPEN-AGE}'),

    -- ---- Ball size (B2:2:2). THIS is where the sexes diverge.
    ('BALL-SIZE-MIXED-U7-U11','BALL_SIZE','ENUM','3',null,
     'Size 3 for Mixed Rugby League, Under 7 to Under 11 (Years 1-6). RFL Operational Rules 2026 B2:2:2.',
     '{RFL-PRIMARY}'),
    ('BALL-SIZE-MALE-U12-U13','BALL_SIZE','ENUM','4',null,
     'Size 4 for MALE players at Under 12 to Under 13 (Years 7-8). B2:2:2.',
     '{RFL-U12,RFL-U13}'),
    ('BALL-SIZE-MALE-U14-PLUS','BALL_SIZE','ENUM','5',null,
     'Size 5 for MALE players at Under 14 and above (Year 9 and above). B2:2:2. Deliberately NOT applied to any female identity below Under 19 -- B2:2:2 keeps female players on size 4 to Under 18.',
     '{RFL-U14,RFL-U15,RFL-U16,RFL-U17,RFL-U18,RFL-U19,RFL-OPEN-AGE}'),
    ('BALL-SIZE-FEMALE-U12-U18','BALL_SIZE','ENUM','4',null,
     'Size 4 for FEMALE players at Under 12 to Under 18 (Years 7-13). B2:2:2. This is an explicit published sex variation: a female Under 14 uses size 4 where a male Under 14 uses size 5, so these identities must never share the male fact.',
     '{RFL-GIRLS-U12,RFL-GIRLS-U13,RFL-GIRLS-U14,RFL-GIRLS-U15,RFL-GIRLS-U16,RFL-GIRLS-U18}'),

    -- ---- Structure and eligibility.
    ('MIXED-TO-U11','PLAYING_ELIGIBILITY','TEXT',
     'Mixed-gender Rugby League is permitted up to and including Under 11s. Each team''s age band is fixed at the start of the season and remains fixed for the whole season, even for matches played after the children move into the next school year.',
     null, 'RFL Operational Rules 2026 Section F10 (Primary Rugby League Rules) 2.3.2 and 2.3.3.',
     '{RFL-PRIMARY}'),
    ('U16-PLAYING-UP','PLAYING_UP_DOWN','TEXT',
     'A player who has reached 16 and is registered in the Under 16s competition is also eligible to play for the club''s Under 17s or Under 18s team, but only where the age group for which they are eligible can still fulfil its own obligations.',
     null, 'RFL Operational Rules 2026 C2:7:7.',
     '{RFL-U16}'),
    ('OPEN-AGE-ELIGIBILITY','PLAYING_ELIGIBILITY','TEXT',
     'To play Open Age Rugby League a player must have reached their 17th birthday, or be a true-age Under 17 player, in which case they may play only from the March in a Season. Any player under 18 requires a parent or guardian signature on the registration form acknowledging that some sections of the RFL Safeguarding Policy do not apply to Adult Rugby League.',
     null, 'RFL Operational Rules 2026 C2:5:1 and C2:5:2.',
     '{RFL-OPEN-AGE}'),
    ('WELFARE-WEEKEND-LIMITS','PLAYING_ELIGIBILITY','TEXT',
     'To protect player welfare the following are not permitted in the same weekend: playing in both mixed junior rugby league and girls'' fixtures; playing in both youth and Open Age matches; playing for a representative team and a community club; playing in a professional academy or reserve fixture and a community match. Where a club runs an appropriate youth team, U17-U18 players should prioritise their correct age group.',
     null, 'RFL Operational Rules 2026 B1:4:5 and B1:4:6.',
     '{RFL-U17,RFL-U18,RFL-U19,RFL-OPEN-AGE}')

    ) as t(slug, fact_type, value_type, v_text, v_int, notes, identities)
  loop
    insert into public.regulatory_facts (
      fact_key, fact_type, topic, rugby_code, value_type,
      value_text, value_duration_minutes, value_enum,
      obligation_level, effective_from, status, verified_by, verified_at, notes, created_by, updated_by
    ) values (
      'RFL-CGOR-2026-' || r.slug, r.fact_type, 'RULES', 'league', r.value_type,
      case when r.value_type = 'TEXT' then r.v_text end,
      case when r.value_type = 'DURATION' then r.v_int end,
      case when r.value_type = 'ENUM' then r.v_text end,
      'MANDATORY', date '2026-01-01', 'VERIFIED', v_importer, now(), r.notes, v_importer, v_importer
    )
    on conflict (fact_key) do nothing
    returning id into v_fact;
    if v_fact is null then
      select id into v_fact from public.regulatory_facts where fact_key = 'RFL-CGOR-2026-' || r.slug;
    end if;

    insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
    select v_fact, ri.id from public.regulatory_identities ri
    where ri.identity_key = any (r.identities::text[])
    on conflict do nothing;

    insert into public.regulatory_fact_citations (fact_id, source_id, support_role, verification_notes, created_by)
    values (v_fact, v_src, 'PRIMARY',
      'Read from the RFL Operational Rules 2026 (Community Game), retrieved directly from rugby-league.com. Machine-extracted from the document''s own text layer.', v_importer)
    on conflict do nothing;

    v_fact := null;
  end loop;
end $$;

-- ============================================================
-- 4. Guards.
-- ============================================================

do $$
declare v_n int; v_bad text;
begin
  -- Nothing orphaned, nothing uncited.
  select count(*) into v_n from public.regulatory_facts f
  where f.fact_key like 'RFL-CGOR-2026-%'
    and not exists (select 1 from public.regulatory_fact_applicability a where a.fact_id = f.id);
  if v_n > 0 then raise exception '% RFL fact(s) apply to no identity.', v_n; end if;

  select count(*) into v_n from public.regulatory_facts f
  where f.fact_key like 'RFL-CGOR-2026-%'
    and not exists (select 1 from public.regulatory_fact_citations c where c.fact_id = f.id);
  if v_n > 0 then raise exception '% RFL fact(s) are uncited.', v_n; end if;

  -- THE SEX VARIATION. No female identity may carry the male size-5 ball fact
  -- below Under 19; every one must carry the female size-4 fact instead.
  select string_agg(ri.identity_key, ', ') into v_bad
  from public.regulatory_fact_applicability a
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  join public.regulatory_facts f on f.id = a.fact_id
  where f.fact_key = 'RFL-CGOR-2026-BALL-SIZE-MALE-U14-PLUS' and ri.identity_key like '%GIRLS%';
  if v_bad is not null then
    raise exception 'The male size-5 ball fact leaked onto female identities: %. RFL B2:2:2 keeps female players on size 4 to Under 18.', v_bad;
  end if;

  select count(*) into v_n
  from public.regulatory_identities ri
  where ri.rugby_code = 'league' and ri.identity_key like 'RFL-GIRLS-%'
    and not exists (
      select 1 from public.regulatory_fact_applicability a
      join public.regulatory_facts f on f.id = a.fact_id
      where a.regulatory_identity_id = ri.id and f.fact_key = 'RFL-CGOR-2026-BALL-SIZE-FEMALE-U12-U18'
    );
  if v_n > 0 then raise exception '% League girls identity/identities lack the female ball-size fact.', v_n; end if;

  -- Code isolation must survive this.
  select count(*) into v_n
  from public.regulatory_facts f
  join public.regulatory_fact_applicability a on a.fact_id = f.id
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  where f.rugby_code <> ri.rugby_code;
  if v_n > 0 then raise exception '% fact/identity pair(s) cross the rugby-code boundary.', v_n; end if;

  -- No Girls U17 may have appeared.
  if exists (select 1 from public.regulatory_identities where identity_key ~* 'girls.*u17') then
    raise exception 'A Girls U17 League identity was created; the required set is U12/U13/U14/U15/U16/U18.';
  end if;
end $$;

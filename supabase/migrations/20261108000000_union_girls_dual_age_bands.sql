-- Union girls rugby is played in DUAL AGE BANDS, not single years.
--
-- WHAT ESTABLISHED THIS
--
-- The developer supplied RFU Regulation 15 - Age Grade Rugby, 2026/27 edition
-- (Effective from 1 August 2026), captured from englandrugby.com. Regulation
-- 15.6 "Playing Out of Age Grade Tables" carries a table headed "PLAYING OUT
-- OF AGE GRADE - FEMALE PLAYERS" whose age grade column reads, in full:
--
--   U12/U11 Dual Age Band (Yr 7/Yr 6)
--   U14/U13 Dual Age Band (Yr 8/Yr 9)
--   U16/U15 Dual Age Band (Yr 11/Yr 10)
--   U18s/U17s Dual Age Band (Yr 13/Yr 12)
--   U19s
--
-- The equivalent male table on the facing page lists U12s, U13s, U14s, U15s,
-- U16s, U17s, U18s as SEPARATE single-year rows. The Competitive Menu at 15.2
-- corroborates it from a different direction: its female columns are "Under 12
-- Female", "Under 14 Female", "Under 16 Female", "Under 18 Female" while its
-- male columns run every year from Under 12 to Under 18. The Summer Activity
-- Plan at 15.10 corroborates it a third time, referring to "U12, 14, 16, 18
-- GIRLS BANDS". Regulation 15.4 states the consequence directly: for girls
-- "the only playing up allowed is within the two-year age band (e.g. a girl in
-- the U14 age band cannot play up in the U16s)".
--
-- So U13, U15 and U17 are not girls' age grades in union at all. A U13 girl
-- plays in the U14/U13 band; a U15 girl plays in the U16/U15 band. Offering a
-- club "Girls U13" as a team identity was inviting them to create a team the
-- RFU does not recognise.
--
-- This also finally explains the Appendix 10 dispute recorded in
-- RFU-REG15-GIRLS-U12-U14-APPENDIX. There is no girls U13 appendix in the
-- current set because there is no girls U13 age grade -- U13 girls are governed
-- by the U14 appendix. Gloucestershire RFU's "Appendix 10 - U13 Girls" was real
-- in 2017 (the developer's 2017 PDF proves it) and describes a structure the
-- RFU has since replaced with the dual age bands.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It does not touch the LEAGUE side. The RFL's girls age structure has not been
-- established from a primary source -- league/girls_u13 and league/girls_u15
-- stay RESEARCH_REQUIRED, exactly as they were. Union evidence must not be
-- applied to a code it does not govern.
--
-- It also leaves U6-U11 girls alone. Regulation 15.2(9) states girls "can play
-- both mixed (with boys) and girls-only rugby at Under 11 and below", so
-- single-year girls-only teams remain valid there. The dual bands start at U12,
-- which is exactly where 15.6 says "From U12s and above, mixed rugby is no
-- longer permitted and different regulations apply to male and female players."

-- ============================================================
-- 1. The missing band. Union girls run to U18/U17, but no girls U18 canonical
--    team type has ever existed -- the girls catalogue stopped at U16, so a
--    club with a girls U18 side could not represent it at all. (Boys U17/U18
--    are carried by Junior/Senior Colts, which are ungendered and so never
--    covered the girls case.)
-- ============================================================

insert into public.canonical_team_types (key, label, category, age_group, gender, allows_squads, sort_order)
values ('girls_u18', 'Girls U18', 'youth', 'U18', 'girls', true, 25)
on conflict (key) do nothing;

-- ============================================================
-- 2. Retire the single-year girls grades that union does not recognise.
--
--    Deactivated, never deleted. `teams.canonical_team_type_id` is a real FK
--    and club history must survive; loadTeamCategoryGroups() already filters
--    on is_active for what it OFFERS while accepting includeInactive for
--    representing a team that already exists. Zero teams currently reference
--    either row, so nothing is stranded by this.
--
--    NOTE this is a GLOBAL catalogue with no rugby_code column, so these rows
--    disappear from the league picker too. That is recorded as a known
--    limitation rather than a decision about league: see the mapping notes
--    below, which keep the league question open.
-- ============================================================

update public.canonical_team_types
set is_active = false, updated_at = now()
where key in ('girls_u13', 'girls_u15');

-- The remaining girls types ARE the bands, so say so where a club will read it.
update public.canonical_team_types set label = 'Girls U12', updated_at = now() where key = 'girls_u12';
update public.canonical_team_types set label = 'Girls U14', updated_at = now() where key = 'girls_u14';
update public.canonical_team_types set label = 'Girls U16', updated_at = now() where key = 'girls_u16';

-- ============================================================
-- 3. Enforce it at the database boundary, per code.
--
--    teams.rugby_code is on the row, so the constraint can be union-specific
--    without touching league. Union girls are valid at U6-U11 (single year,
--    girls-only permitted by 15.2(9)) and at the four band grades. U13, U15
--    and U17 are not union girls age grades and are refused.
-- ============================================================

alter table public.teams drop constraint if exists teams_gender_category_check;

alter table public.teams add constraint teams_gender_category_check
  check (
    gender is null
    or (category = 'senior' and gender in ('mens', 'womens'))
    or (category = 'youth' and gender = 'mixed' and (age_group is null or age_group in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11')))
    or (category = 'youth' and gender = 'boys')
    or (
      category = 'youth' and gender = 'girls'
      and (
        age_group is null
        or rugby_code is distinct from 'union'
        or age_group in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11', 'U12', 'U14', 'U16', 'U18')
      )
    )
  );

comment on constraint teams_gender_category_check on public.teams is
  'Senior teams: mens/womens only. Youth: boys at any age; mixed only U6-U11 (RFU Reg 15.6 -- mixed rugby ends at U12); girls at U6-U11 single years (Reg 15.2(9) permits girls-only there) and, IN UNION ONLY, at the U12/U14/U16/U18 dual age bands defined by Reg 15.6. Union girls U13/U15/U17 are refused because those are not RFU age grades -- a U13 girl plays in the U14/U13 band. League girls are deliberately unconstrained: the RFL structure has not been established from a primary source.';

-- ============================================================
-- 4. The four girls band identities. These could not be created in Phase 4A --
--    the girls appendix conflict blocked them precisely because we could not
--    establish whether girls' Rules of Play differed. Regulation 15.6 now
--    establishes the structure from the RFU's own document.
--
--    The label names the band explicitly so nothing downstream has to infer
--    that "U14" silently includes 13-year-olds.
-- ============================================================

insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, ovalball_canonical_team_type_id, mapping_notes, source_register_reference)
select 'union', v.identity_key, v.label, 'DIRECT', ctt.id, v.notes, 'RFU Regulation 15.6 (Effective 1 August 2026)'
from (values
  ('RFU-GIRLS-U12', 'RFU Girls U12/U11 Dual Age Band (Yr 7/Yr 6)', 'girls_u12', 'Regulation 15.6 female table. Contains school Years 7 and 6.'),
  ('RFU-GIRLS-U14', 'RFU Girls U14/U13 Dual Age Band (Yr 9/Yr 8)', 'girls_u14', 'Regulation 15.6 female table. Contains school Years 9 and 8 -- this is the band a U13 girl plays in, and the reason no separate girls U13 appendix exists.'),
  ('RFU-GIRLS-U16', 'RFU Girls U16/U15 Dual Age Band (Yr 11/Yr 10)', 'girls_u16', 'Regulation 15.6 female table. Contains school Years 11 and 10.'),
  ('RFU-GIRLS-U18', 'RFU Girls U18/U17 Dual Age Band (Yr 13/Yr 12)', 'girls_u18', 'Regulation 15.6 female table. Contains school Years 13 and 12. 17- and 18-year-olds may play up under Regulations 15.7 and 15.8.')
) as v(identity_key, label, team_type_key, notes)
join public.canonical_team_types ctt on ctt.key = v.team_type_key
on conflict (identity_key) do nothing;

-- ============================================================
-- 5. Map the union girls team types onto those identities, and mark the
--    single-year grades NOT_OFFERED with the reason. League rows are not
--    touched by any statement here.
-- ============================================================

-- girls_u18 has no mapping rows at all yet (the type was created above).
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, mapping_state, notes)
select ctt.id, c.code, 'RESEARCH_REQUIRED',
  'Created alongside the new girls_u18 canonical team type. The union row is upgraded to MAPPED immediately below; the league row stays RESEARCH_REQUIRED because the RFL girls age structure has not been established from a primary source.'
from public.canonical_team_types ctt
cross join (values ('union'), ('league')) as c(code)
where ctt.key = 'girls_u18'
on conflict (canonical_team_type_id, rugby_code) do nothing;

update public.regulatory_team_type_mappings m
set mapping_state = 'MAPPED',
    regulatory_identity_id = ri.id,
    notes = null,
    updated_at = now()
from public.canonical_team_types ctt, public.regulatory_identities ri
where m.canonical_team_type_id = ctt.id
  and m.rugby_code = 'union'
  and ctt.key in ('girls_u12', 'girls_u14', 'girls_u16', 'girls_u18')
  and ri.identity_key = 'RFU-GIRLS-' || upper(replace(ctt.key, 'girls_', ''));

update public.regulatory_team_type_mappings m
set mapping_state = 'NOT_OFFERED',
    regulatory_identity_id = null,
    notes = 'Not a girls age grade in union. RFU Regulation 15.6 (Effective 1 August 2026) defines the female game as four dual age bands -- U12/U11, U14/U13, U16/U15, U18/U17 -- so a girl of this age plays in the band named by the older year, not in a single-year grade of her own. Corroborated by the Regulation 15.2 Competitive Menu (female columns are Under 12/14/16/18 Female only) and by Regulation 15.4 ("the only playing up allowed is within the two-year age band"). The canonical team type is deactivated globally; if the RFL turns out to run single-year girls grades, reactivate it and keep this union row NOT_OFFERED.',
    updated_at = now()
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id
  and m.rugby_code = 'union'
  and ctt.key in ('girls_u13', 'girls_u15');

-- ============================================================
-- 6. Rollover must step girls forward by TWO years, not one.
--
--    internal.next_age_grade() is gender-blind and steps by one, which is
--    right for boys and mixed and wrong for union girls: it would roll a
--    Girls U12 band team into a "Girls U13" grade that does not exist and
--    that the constraint above now refuses -- turning a silent data error
--    into a failed rollover, which is better but still a dead end.
--
--    The existing function is left exactly as it is (it has other callers,
--    including the mini-rugby scheduling-group check below it) and a
--    gender/code-aware wrapper is added beside it.
-- ============================================================

create or replace function internal.next_age_grade_for(p_age_group text, p_gender text, p_rugby_code text)
returns text
language sql
immutable
as $$
  select case
    -- Union girls from U12 up move band to band, and U18 is the last one:
    -- the next step is adult women's rugby, which rollover does not do
    -- mechanically (it returns null, which routes to a manual choice).
    when p_gender = 'girls' and p_rugby_code = 'union' and p_age_group in ('U12', 'U14', 'U16', 'U18') then
      case p_age_group when 'U12' then 'U14' when 'U14' then 'U16' when 'U16' then 'U18' else null end
    -- Union girls below U12 are still single-year, but U11 girls cross into
    -- the U12/U11 band rather than into a single-year U12 grade. Same value,
    -- different meaning -- worth stating rather than falling through.
    when p_gender = 'girls' and p_rugby_code = 'union' and p_age_group = 'U11' then 'U12'
    else internal.next_age_grade(p_age_group)
  end;
$$;

comment on function internal.next_age_grade_for(text, text, text) is
  'Age-grade succession that knows about RFU Regulation 15.6 dual age bands. Union girls step U12 -> U14 -> U16 -> U18 -> (null, meaning adult women''s rugby and a manual decision); everything else defers to internal.next_age_grade(). Deliberately code-scoped: league girls fall through to the single-year default because the RFL structure is not established.';

-- generate_rollover_proposal: the team loop now reads the team's gender and
-- code and uses the band-aware successor. Everything else about the function
-- -- the mixed-boundary detection, the scheduling-group flags, the
-- authorization check -- is carried over unchanged.
create or replace function public.generate_rollover_proposal(p_club_id uuid, p_rugby_code text, p_to_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rollover_id uuid;
  v_from_season_id uuid;
  t record;
  v_group record;
  v_would_be_ages text[];
  v_next_age text;
  v_requires_manual boolean;
  v_is_mixed_boundary boolean;
begin
  if not (internal.can_manage_club_fixtures(p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to propose a rollover for this club.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;

  select id into v_from_season_id from public.seasons where rugby_code = p_rugby_code and ends_on < (select starts_on from public.seasons where id = p_to_season_id) order by ends_on desc limit 1;

  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, auth.uid())
  returning id into v_rollover_id;

  for t in
    select id, age_group, gender, rugby_code from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null and age_group <> 'U6'
  loop
    -- Band-aware: a union Girls U12 team rolls to U14, not U13.
    v_next_age := internal.next_age_grade_for(t.age_group, t.gender, t.rugby_code);
    v_is_mixed_boundary := coalesce(t.gender, '') = 'mixed' and v_next_age is not null and v_next_age not in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11');
    v_requires_manual := v_next_age is null or v_is_mixed_boundary;

    insert into public.age_grade_rollover_team_proposals (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary)
    values (
      v_rollover_id, t.id, t.age_group,
      case when v_next_age is null then null else v_next_age end,
      v_requires_manual,
      v_is_mixed_boundary
    )
    on conflict (rollover_id, team_id) do nothing;
  end loop;

  for v_group in
    select sg.id, sg.display_tag from public.scheduling_groups sg where sg.club_id = p_club_id and sg.active
  loop
    select array_agg(distinct internal.next_age_grade(mt.age_group)) into v_would_be_ages
    from public.scheduling_group_members sgm join public.teams mt on mt.id = sgm.team_id
    where sgm.group_id = v_group.id;

    if exists (select 1 from unnest(v_would_be_ages) a where a not in ('U6', 'U7', 'U8') or a is null) then
      insert into public.age_grade_rollover_group_flags (rollover_id, scheduling_group_id, reason)
      values (v_rollover_id, v_group.id, format('Rolling forward would produce an invalid combination outside the U6-U8 mini-rugby band (currently %s).', v_group.display_tag))
      on conflict (rollover_id, scheduling_group_id) do nothing;
    end if;
  end loop;

  return v_rollover_id;
end;
$$;

revoke execute on function public.generate_rollover_proposal(uuid, text, uuid) from public;
grant execute on function public.generate_rollover_proposal(uuid, text, uuid) to authenticated;

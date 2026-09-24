-- ===========================================================================
-- THE RULES OF PLAY REACH THE PLATFORM (RH-M0.2)
-- ===========================================================================
--
-- THE FINDING. RH-M0.1 proved both clients agree with the canonical Rules bundle -- and that the
-- bundle is identical for every RFU age grade, because `resolve_age_grade_rule_bundle` reads only
-- the PUBLISHED regulatory content SETS: World Rugby's general Laws (Tier 2) and, for one League
-- identity, a Tier-1 set. The governing bodies' age-grade Rules of Play -- RFU Regulation 15's
-- pitch, ball, player numbers, contact, kicking, scrum, restarts, substitutions, eligibility -- are
-- VERIFIED `regulatory_facts` attached to their identities through `regulatory_fact_applicability`,
-- and nothing read them. A parent of an Under 8 saw the same page as a parent of an Under 12.
--
-- THE READ. One resolver, `internal.resolve_age_grade_rules_of_play`, answers "which VERIFIED
-- Rules-of-Play facts apply to THIS regulatory identity today" from the applicability register:
-- the identity's own rows, no competition overlay, effective as of the date, and NOT already shown
-- as a General Law through a published RULES content set of the same code (so a fact is never on
-- the page twice). It knows nothing about team names or age numbers: age and code arrive as a
-- regulatory identity, resolved by `regulatory_context_for_team` from the team's canonical type,
-- exactly as the existing Rules read already does.
--
-- Two public readers mirror the two existing ones. `get_rugby_hub_rules_of_play(p_team_id)` is the
-- viewer's own team, authorised by `regulatory_context_for_team` (team.team.view or an active player
-- or guardian relationship), silent for NO_DIRECT_MAPPING or an unmapped type.
-- `get_rugby_hub_rules_of_play_by_identity(p_identity_key)` is the browse mode a search result lands
-- in. Both are authenticated-only: `regulatory_facts` has no public read policy, and this keeps it so.
--
-- SEARCH. `search_hub_content` already offers RULE rows only where a fact has a destination. A
-- Rules-of-Play fact now HAS one -- the Rules page of its identity, at the section named by its
-- category -- so `regulatory_fact_primary_occurrence` gains an applicability path after the skill
-- and content-set paths, and `get_regulatory_fact_search_context` gains an optional viewer identity
-- so a fact that applies to several age grades resolves to the viewer's own where it can. No orphan
-- result: every RULE row search returns now names a page and a section that render.
--
-- Forward-only. No data changed; no grant widened.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The canonical resolver
-- ---------------------------------------------------------------------------
create or replace function internal.resolve_age_grade_rules_of_play(
  p_rugby_code text,
  p_regulatory_identity_id uuid,
  p_as_of_date date default current_date,
  p_gender_pathway text default null
)
returns table(
  fact_id uuid, fact_key text, fact_type text, section_key text, display_title text,
  value_type text, value_integer integer, value_decimal numeric, value_boolean boolean,
  value_duration_minutes integer, value_distance_metres numeric, value_range_min numeric, value_range_max numeric,
  value_enum text, value_text text, value_unit text,
  obligation_level text, body text, effective_from date,
  primary_source_key text, primary_source_locator text,
  applies_to_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_rugby_code not in ('union', 'league') then raise exception 'Invalid rugby_code.' using errcode = '22023'; end if;
  if p_regulatory_identity_id is null then return; end if;
  if not exists (select 1 from public.regulatory_identities ri where ri.id = p_regulatory_identity_id and ri.rugby_code = p_rugby_code) then
    raise exception 'The given regulatory identity does not belong to the given rugby code.' using errcode = '22023';
  end if;

  return query
  with shown_as_general_law as (
    -- Already on the page as a General Law (or a Tier-1 variation): never listed twice.
    select sec.fact_id
    from public.regulatory_content_sections sec
    join public.regulatory_content_sets cs on cs.id = sec.content_set_id
    where cs.publication_state = 'PUBLISHED' and cs.topic = 'RULES' and cs.rugby_code = p_rugby_code
      and (cs.effective_from is null or cs.effective_from <= p_as_of_date)
      and (cs.effective_to is null or cs.effective_to >= p_as_of_date)
  ),
  applicable as (
    select f.id
    from public.regulatory_fact_applicability fa
    join public.regulatory_facts f on f.id = fa.fact_id
    where fa.regulatory_identity_id = p_regulatory_identity_id
      and fa.competition_overlay_id is null
      and (fa.gender_pathway is null or p_gender_pathway is null or fa.gender_pathway = p_gender_pathway)
      and f.status = 'VERIFIED' and f.topic = 'RULES' and f.rugby_code = p_rugby_code
      and (f.effective_from is null or f.effective_from <= p_as_of_date)
      and (f.effective_to is null or f.effective_to >= p_as_of_date)
      and not exists (select 1 from shown_as_general_law g where g.fact_id = f.id)
  ),
  primary_citation as (
    select distinct on (c.fact_id) c.fact_id, s.source_key, l.locator_type, l.locator_value
    from public.regulatory_fact_citations c
    join public.regulatory_sources s on s.id = c.source_id
    left join public.regulatory_source_locators l on l.id = c.locator_id
    where c.fact_id in (select a.id from applicable a)
    order by c.fact_id, (c.support_role = 'PRIMARY') desc, c.created_at asc
  ),
  reach as (
    -- How many identities of this code the same fact applies to -- so a page can say
    -- "applies across N age grades" honestly, and search can group on it.
    select fa.fact_id, count(distinct fa.regulatory_identity_id)::integer as n
    from public.regulatory_fact_applicability fa
    join public.regulatory_identities ri on ri.id = fa.regulatory_identity_id and ri.rugby_code = p_rugby_code
    where fa.fact_id in (select a.id from applicable a) and fa.competition_overlay_id is null
    group by fa.fact_id
  )
  select f.id, f.fact_key, f.fact_type,
    case when f.fact_type in ('PITCH_LENGTH', 'PITCH_WIDTH', 'PITCH_VARIATION') then 'PITCH' else f.fact_type end as section_key,
    f.display_title,
    f.value_type, f.value_integer, f.value_decimal, f.value_boolean,
    f.value_duration_minutes, f.value_distance_metres, f.value_range_min, f.value_range_max,
    f.value_enum, f.value_text, f.value_unit,
    f.obligation_level, f.notes as body, f.effective_from,
    pc.source_key,
    case when pc.locator_type is not null then pc.locator_type || ': ' || pc.locator_value else null end,
    coalesce(r.n, 1)
  from applicable a
  join public.regulatory_facts f on f.id = a.id
  left join primary_citation pc on pc.fact_id = f.id
  left join reach r on r.fact_id = f.id
  order by f.fact_type, f.effective_from nulls last, f.fact_key;
end;
$function$;

comment on function internal.resolve_age_grade_rules_of_play(text, uuid, date, text) is
  'The governing body''s age-grade Rules of Play for one regulatory identity as of a date: VERIFIED RULES facts attached through regulatory_fact_applicability (no competition overlay), excluding any fact already presented as a General Law through a published RULES content set of the same code. Section = the fact''s category (pitch length/width/variation fold into PITCH). Age and code arrive as an identity -- never derived from a team name.';

-- ---------------------------------------------------------------------------
-- 2. The two public readers
-- ---------------------------------------------------------------------------
create or replace function public.get_rugby_hub_rules_of_play(p_team_id uuid, p_as_of_date date default current_date)
returns table(
  fact_id uuid, fact_key text, fact_type text, section_key text, display_title text,
  value_type text, value_integer integer, value_decimal numeric, value_boolean boolean,
  value_duration_minutes integer, value_distance_metres numeric, value_range_min numeric, value_range_max numeric,
  value_enum text, value_text text, value_unit text,
  obligation_level text, body text, effective_from date,
  primary_source_key text, primary_source_locator text,
  applies_to_count integer,
  identity_key text, identity_label text, identity_rugby_code text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rugby_code text; v_identity_id uuid; v_mapping_type text;
  v_identity_key text; v_identity_label text; v_pathway text;
begin
  -- Authorisation lives in regulatory_context_for_team: team.team.view, or an active player or
  -- guardian relationship. It raises 42501 for anybody else.
  select rc.rugby_code, rc.regulatory_identity_id, rc.mapping_type
    into v_rugby_code, v_identity_id, v_mapping_type
  from internal.regulatory_context_for_team(p_team_id) rc;

  if v_rugby_code is null or v_identity_id is null then return; end if;
  if v_mapping_type = 'NO_DIRECT_MAPPING' then return; end if;

  select ri.identity_key, ri.label into v_identity_key, v_identity_label
  from public.regulatory_identities ri where ri.id = v_identity_id;

  -- The team's recorded side, for the few applicability rows that are pathway-scoped. A mixed
  -- side matches every row; Ovalball never assumes a pathway.
  select case t.gender when 'boys' then 'MALE' when 'mens' then 'MALE' when 'girls' then 'FEMALE' when 'womens' then 'FEMALE' else null end
    into v_pathway
  from public.teams t where t.id = p_team_id;

  return query
    select b.*, v_identity_key, v_identity_label, v_rugby_code
    from internal.resolve_age_grade_rules_of_play(v_rugby_code, v_identity_id, p_as_of_date, v_pathway) b;
end;
$function$;

comment on function public.get_rugby_hub_rules_of_play(uuid, date) is
  'The viewer''s own team''s age-grade Rules of Play (see internal.resolve_age_grade_rules_of_play). Authorised through regulatory_context_for_team; nothing for a team whose canonical type has no direct regulatory identity.';

create or replace function public.get_rugby_hub_rules_of_play_by_identity(p_identity_key text)
returns table(
  fact_id uuid, fact_key text, fact_type text, section_key text, display_title text,
  value_type text, value_integer integer, value_decimal numeric, value_boolean boolean,
  value_duration_minutes integer, value_distance_metres numeric, value_range_min numeric, value_range_max numeric,
  value_enum text, value_text text, value_unit text,
  obligation_level text, body text, effective_from date,
  primary_source_key text, primary_source_locator text,
  applies_to_count integer,
  identity_key text, identity_label text, identity_rugby_code text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_code text; v_label text;
begin
  select ri.id, ri.rugby_code, ri.label into v_id, v_code, v_label
  from public.regulatory_identities ri where ri.identity_key = p_identity_key;
  if v_id is null then return; end if;

  return query
    select b.*, p_identity_key, v_label, v_code
    from internal.resolve_age_grade_rules_of_play(v_code, v_id, current_date, null) b;
end;
$function$;

comment on function public.get_rugby_hub_rules_of_play_by_identity(text) is
  'Browse mode: one regulatory identity''s age-grade Rules of Play, whoever is looking. The destination a Rules-of-Play search result lands in. Authenticated only -- regulatory_facts has no public read policy.';

revoke execute on function public.get_rugby_hub_rules_of_play(uuid, date) from public, anon;
revoke execute on function public.get_rugby_hub_rules_of_play_by_identity(text) from public, anon;
revoke execute on function internal.resolve_age_grade_rules_of_play(text, uuid, date, text) from public, anon, authenticated;
grant execute on function public.get_rugby_hub_rules_of_play(uuid, date) to authenticated, service_role;
grant execute on function public.get_rugby_hub_rules_of_play_by_identity(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Search: a Rules-of-Play fact has a destination
-- ---------------------------------------------------------------------------
-- The occurrence resolver keeps its precedence (a skill page first, then a published content-set
-- section) and adds the applicability path last: the Rules page of an identity the fact applies to,
-- at the section its category names. When the viewer's own identity is among them it wins; else
-- the first by identity key, deterministically.
--
-- One function with a defaulted second argument replaces the one-argument form: a separate
-- overload would make every existing single-argument call (search_hub_content's included) ambiguous.
-- SQL-language bodies are not dependency-tracked, so the drop is safe and those callers resolve to
-- this definition on their next call.
drop function if exists internal.regulatory_fact_primary_occurrence(uuid);
create function internal.regulatory_fact_primary_occurrence(p_fact_id uuid, p_viewer_identity_id uuid default null)
returns table(destination_kind text, skill_key text, topic text, identity_key text, regulatory_identity_id uuid, rugby_code text, section_key text, occurrence_count integer)
language sql
stable
security definer
set search_path to 'public', 'internal'
as $function$
  with skill_path as (
    select s.skill_key
    from public.hub_regulatory_fact_references r
    join public.hub_content_items ci on ci.id = r.content_item_id and ci.status = 'PUBLISHED'
    join public.hub_skill_content_links l on l.content_item_id = ci.id
    join public.hub_skills s on s.id = l.skill_id and s.status = 'PUBLISHED'
    where r.regulatory_fact_id = p_fact_id
    order by s.skill_key
    limit 1
  ),
  rules_path as (
    select cs.topic, ri.identity_key, ri.id as regulatory_identity_id, cs.rugby_code,
      case when f.fact_type in ('PITCH_LENGTH', 'PITCH_WIDTH') then 'PITCH' else sec.section_key end as section_key
    from public.regulatory_content_sections sec
    join public.regulatory_content_sets cs on cs.id = sec.content_set_id
    join public.regulatory_facts f on f.id = sec.fact_id
    left join public.regulatory_identities ri on ri.id = cs.regulatory_identity_id
    where sec.fact_id = p_fact_id
      and cs.publication_state = 'PUBLISHED'
      and (cs.effective_from is null or cs.effective_from <= current_date)
      and (cs.effective_to is null or cs.effective_to >= current_date)
    order by cs.content_set_key, sec.section_key
    limit 1
  ),
  applicability_path as (
    -- The Rules of Play: a VERIFIED, currently-effective RULES fact attached to an identity.
    select f.topic, ri.identity_key, ri.id as regulatory_identity_id, f.rugby_code,
      case when f.fact_type in ('PITCH_LENGTH', 'PITCH_WIDTH', 'PITCH_VARIATION') then 'PITCH' else f.fact_type end as section_key
    from public.regulatory_fact_applicability fa
    join public.regulatory_facts f on f.id = fa.fact_id
    join public.regulatory_identities ri on ri.id = fa.regulatory_identity_id and ri.rugby_code = f.rugby_code
    where fa.fact_id = p_fact_id
      and fa.competition_overlay_id is null
      and f.status = 'VERIFIED' and f.topic = 'RULES'
      and (f.effective_from is null or f.effective_from <= current_date)
      and (f.effective_to is null or f.effective_to >= current_date)
    order by (p_viewer_identity_id is not null and ri.id = p_viewer_identity_id) desc, ri.identity_key
    limit 1
  ),
  counted as (
    select
      (select count(*) from public.hub_regulatory_fact_references r
         join public.hub_content_items ci on ci.id = r.content_item_id and ci.status = 'PUBLISHED'
       where r.regulatory_fact_id = p_fact_id)
      +
      (select count(*) from public.regulatory_content_sections sec
         join public.regulatory_content_sets cs on cs.id = sec.content_set_id
       where sec.fact_id = p_fact_id and cs.publication_state = 'PUBLISHED'
         and (cs.effective_from is null or cs.effective_from <= current_date)
         and (cs.effective_to is null or cs.effective_to >= current_date))
      +
      (select count(*) from public.regulatory_fact_applicability fa
         join public.regulatory_facts f on f.id = fa.fact_id
       where fa.fact_id = p_fact_id and fa.competition_overlay_id is null
         and f.status = 'VERIFIED' and f.topic = 'RULES'
         and (f.effective_from is null or f.effective_from <= current_date)
         and (f.effective_to is null or f.effective_to >= current_date))
      as cnt
  )
  select
    case
      when (select skill_key from skill_path) is not null then 'SKILL'
      when (select topic from rules_path) is not null then 'RULES_PAGE'
      when (select topic from applicability_path) is not null then 'RULES_PAGE'
      else null
    end,
    (select skill_key from skill_path),
    coalesce((select topic from rules_path), (select topic from applicability_path)),
    coalesce((select identity_key from rules_path), (select identity_key from applicability_path)),
    coalesce((select regulatory_identity_id from rules_path), (select regulatory_identity_id from applicability_path)),
    coalesce((select rugby_code from rules_path), (select rugby_code from applicability_path)),
    coalesce((select section_key from rules_path), (select section_key from applicability_path)),
    (select cnt from counted);
$function$;

-- The search-context RPC gains the optional viewer identity. Its signature changes, so the old one
-- is dropped and the grants re-stated exactly as the API perimeter migration set them.
drop function if exists public.get_regulatory_fact_search_context(uuid[]);
create function public.get_regulatory_fact_search_context(p_fact_ids uuid[], p_viewer_identity_id uuid default null)
returns table(fact_id uuid, destination_kind text, skill_key text, topic text, identity_key text, regulatory_identity_id uuid, rugby_code text, section_key text, occurrence_count integer)
language sql
stable
security definer
set search_path to 'public', 'internal'
as $function$
  select f.id, oc.destination_kind, oc.skill_key, oc.topic, oc.identity_key, oc.regulatory_identity_id, oc.rugby_code, oc.section_key, oc.occurrence_count
  from public.regulatory_facts f
  cross join lateral internal.regulatory_fact_primary_occurrence(f.id, p_viewer_identity_id) oc
  where f.id = any(p_fact_ids) and f.status = 'VERIFIED';
$function$;

revoke execute on function public.get_regulatory_fact_search_context(uuid[], uuid) from public, anon;
grant execute on function public.get_regulatory_fact_search_context(uuid[], uuid) to authenticated, service_role;

comment on function public.get_regulatory_fact_search_context(uuid[], uuid) is
  'Where each VERIFIED regulatory fact is presented (skill page, content-set section, or the Rules of Play of an identity it applies to) so a search result always lands somewhere that renders. The optional viewer identity prefers the viewer''s own age grade when a fact applies to several.';

-- ---------------------------------------------------------------------------
-- 4. Guards
-- ---------------------------------------------------------------------------
do $$
declare v_n int; v_orphans int;
begin
  -- anon never reaches regulatory_facts through these
  if has_function_privilege('anon', 'public.get_rugby_hub_rules_of_play(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_rugby_hub_rules_of_play_by_identity(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_regulatory_fact_search_context(uuid[], uuid)', 'EXECUTE') then
    raise exception 'Rules of Play readers must not be executable by anon';
  end if;

  -- every RULE row search could return now has a destination
  select count(*) into v_orphans
  from public.regulatory_facts f
  cross join lateral internal.regulatory_fact_primary_occurrence(f.id) oc
  where f.status = 'VERIFIED' and f.topic = 'RULES'
    and (f.effective_from is null or f.effective_from <= current_date)
    and (f.effective_to is null or f.effective_to >= current_date)
    and oc.destination_kind is null
    and exists (select 1 from public.regulatory_fact_applicability fa where fa.fact_id = f.id and fa.competition_overlay_id is null);
  if v_orphans > 0 then
    raise exception '% currently-effective applicable RULES facts still have no search destination', v_orphans;
  end if;

  -- a fact never appears both as a General Law and as a Rule of Play for the same identity
  select count(*) into v_n
  from public.regulatory_identities ri
  cross join lateral internal.resolve_age_grade_rules_of_play(ri.rugby_code, ri.id, current_date, null) rp
  join lateral internal.resolve_age_grade_rule_bundle(ri.rugby_code, ri.id, current_date, null) gl on gl.fact_id = rp.fact_id;
  if v_n > 0 then
    raise exception '% facts would be listed both as General Law and as a Rule of Play', v_n;
  end if;
end $$;

-- Regulatory content resolvers -- security-hardened for real Main
-- integration (Rugby Hub Phase 2).
--
-- This is the reconciliation SP3's own docs flagged as the one genuinely
-- unsafe-as-shipped piece (docs/SIDE_PROJECT_3_INTEGRATION_MANIFEST.md):
-- every one of SP3's domain resolvers accepted rugby_code/regulatory_
-- identity_id as bare, client-suppliable parameters, correct for proving
-- the DATA-LAYER isolation boundary in isolation but "a real vulnerability
-- in production" as shipped. The fix here is structural, not a patch: the
-- data-layer resolvers move to the `internal` schema (never reachable via
-- PostgREST regardless of any grant), and the only `public.` entry points
-- accept a real, validated Main identifier -- a team_id the caller has a
-- genuine relationship to (guardian of a player on it, is a player on it,
-- staff, or site admin) -- exactly the same pattern already proven for
-- Match Centre (20261028000000_match_centre_capabilities.sql). rugby_code
-- and regulatory_identity_id are then derived server-side from that team's
-- own real rugby_code/canonical_team_type_id, via the real foreign key
-- regulatory_identities.ovalball_canonical_team_type_id now provides.
--
-- No regulatory content exists yet (Phase 2 is schema-only), so every
-- function here will legitimately return empty until Phase 3 populates
-- real, reviewed content -- that is the correct, honest behaviour, not a
-- bug to work around.

-- ---------------------------------------------------------------------
-- 1. Internal data-layer resolvers (never public) -- SP3's own logic,
--    unchanged, moved out of the `public` schema.
-- ---------------------------------------------------------------------

create or replace function internal.resolve_published_regulatory_content(
  p_rugby_code text, p_topic text, p_regulatory_identity_id uuid, p_as_of_date date default current_date
)
returns table (
  content_set_id uuid, content_set_key text, regulatory_identity_id uuid, season_id uuid,
  effective_from date, effective_to date, version integer, published_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_overlap_count integer;
begin
  if p_rugby_code not in ('union', 'league') then raise exception 'Invalid rugby_code.' using errcode = '22023'; end if;
  if p_topic not in ('RULES', 'SAFEGUARDING', 'PLAYER_WELFARE') then raise exception 'Invalid topic.' using errcode = '22023'; end if;
  if p_regulatory_identity_id is not null and not exists (
    select 1 from public.regulatory_identities where id = p_regulatory_identity_id and rugby_code = p_rugby_code
  ) then
    raise exception 'The given regulatory identity does not belong to the given rugby code.' using errcode = '22023';
  end if;

  select count(*) into v_overlap_count
  from public.regulatory_content_sets s
  where s.publication_state = 'PUBLISHED' and s.rugby_code = p_rugby_code and s.topic = p_topic
    and (s.regulatory_identity_id = p_regulatory_identity_id or (s.regulatory_identity_id is null and p_regulatory_identity_id is null))
    and (s.effective_from is null or s.effective_from <= p_as_of_date)
    and (s.effective_to is null or s.effective_to >= p_as_of_date);

  if v_overlap_count > 1 then
    raise exception 'Ambiguous published content: % overlapping PUBLISHED content sets cover % for this rugby_code/topic/identity. Must be resolved by an authorized regulatory admin, not guessed.', v_overlap_count, p_as_of_date using errcode = '22023';
  end if;

  return query
  select s.id, s.content_set_key, s.regulatory_identity_id, s.season_id, s.effective_from, s.effective_to, s.version, s.published_at
  from public.regulatory_content_sets s
  where s.publication_state = 'PUBLISHED' and s.rugby_code = p_rugby_code and s.topic = p_topic
    and (s.regulatory_identity_id = p_regulatory_identity_id or (s.regulatory_identity_id is null and p_regulatory_identity_id is null))
    and (s.effective_from is null or s.effective_from <= p_as_of_date)
    and (s.effective_to is null or s.effective_to >= p_as_of_date);
end;
$function$;

create or replace function internal.resolve_age_grade_rule_bundle(
  p_rugby_code text, p_regulatory_identity_id uuid, p_as_of_date date default current_date, p_competition_overlay_id uuid default null
)
returns table (
  content_set_id uuid, section_key text, fact_id uuid, fact_key text, fact_type text, value_type text,
  value_integer integer, value_decimal numeric, value_boolean boolean, value_duration_minutes integer,
  value_distance_metres numeric, value_range_min numeric, value_range_max numeric, value_enum text, value_text text, value_unit text,
  is_overlay boolean, primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_content_set_id uuid;
begin
  select rc.content_set_id into v_content_set_id
  from internal.resolve_published_regulatory_content(p_rugby_code, 'RULES', p_regulatory_identity_id, p_as_of_date) rc;
  if v_content_set_id is null then return; end if;

  return query
  with base as (
    select sec.section_key, sec.fact_id, f.fact_type
    from public.regulatory_content_sections sec join public.regulatory_facts f on f.id = sec.fact_id
    where sec.content_set_id = v_content_set_id and f.status = 'VERIFIED'
  ),
  overlay_candidates as (
    select distinct on (b.section_key) b.section_key, f2.id as overlay_fact_id
    from base b
    join public.regulatory_facts f2 on f2.fact_type = b.fact_type and f2.status = 'VERIFIED'
    join public.regulatory_fact_applicability fa on fa.fact_id = f2.id
    where p_competition_overlay_id is not null and fa.regulatory_identity_id = p_regulatory_identity_id and fa.competition_overlay_id = p_competition_overlay_id
    order by b.section_key, f2.id
  ),
  applicable as (
    select b.section_key, coalesce(oc.overlay_fact_id, b.fact_id) as fact_id, (oc.overlay_fact_id is not null) as is_overlay
    from base b left join overlay_candidates oc on oc.section_key = b.section_key
  ),
  primary_citation as (
    select distinct on (c.fact_id) c.fact_id, s.source_key, l.locator_type, l.locator_value
    from public.regulatory_fact_citations c
    join public.regulatory_sources s on s.id = c.source_id
    left join public.regulatory_source_locators l on l.id = c.locator_id
    order by c.fact_id, (c.support_role = 'PRIMARY') desc, c.created_at asc
  )
  select v_content_set_id, a.section_key, f.id, f.fact_key, f.fact_type, f.value_type,
    f.value_integer, f.value_decimal, f.value_boolean, f.value_duration_minutes,
    f.value_distance_metres, f.value_range_min, f.value_range_max, f.value_enum, f.value_text, f.value_unit,
    a.is_overlay, pc.source_key,
    case when pc.locator_type is not null then pc.locator_type || ': ' || pc.locator_value else null end
  from applicable a
  join public.regulatory_facts f on f.id = a.fact_id
  left join primary_citation pc on pc.fact_id = f.id;
end;
$function$;

create or replace function internal.resolve_safeguarding_content_bundle(
  p_rugby_code text, p_as_of_date date default current_date, p_regulatory_identity_id uuid default null, p_audience text default 'GENERAL'
)
returns table (
  content_set_id uuid, section_key text, display_order integer, fact_id uuid, fact_type text, value_type text,
  value_text text, value_boolean boolean, body text, primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_content_set_id uuid;
begin
  select rc.content_set_id into v_content_set_id
  from internal.resolve_published_regulatory_content(p_rugby_code, 'SAFEGUARDING', p_regulatory_identity_id, p_as_of_date) rc;
  if v_content_set_id is null then return; end if;

  return query
  with sections as (
    select sec.id, sec.section_key, sec.display_order, sec.fact_id
    from public.regulatory_content_sections sec where sec.content_set_id = v_content_set_id
  ),
  requested_copy as (select ac.content_section_id, ac.body from public.regulatory_content_section_audience_copy ac where ac.audience = p_audience),
  general_copy as (select ac.content_section_id, ac.body from public.regulatory_content_section_audience_copy ac where ac.audience = 'GENERAL'),
  primary_citation as (
    select distinct on (c.fact_id) c.fact_id, s.source_key, l.locator_type, l.locator_value
    from public.regulatory_fact_citations c
    join public.regulatory_sources s on s.id = c.source_id
    left join public.regulatory_source_locators l on l.id = c.locator_id
    order by c.fact_id, (c.support_role = 'PRIMARY') desc, c.created_at asc
  )
  select v_content_set_id, sections.section_key, sections.display_order, f.id, f.fact_type, f.value_type,
    f.value_text, f.value_boolean, coalesce(rq.body, gc.body), pc.source_key,
    case when pc.locator_type is not null then pc.locator_type || ': ' || pc.locator_value else null end
  from sections
  left join public.regulatory_facts f on f.id = sections.fact_id and f.status = 'VERIFIED'
  left join requested_copy rq on rq.content_section_id = sections.id
  left join general_copy gc on gc.content_section_id = sections.id
  left join primary_citation pc on pc.fact_id = f.id
  order by sections.display_order;
end;
$function$;

create or replace function internal.resolve_safeguarding_reporting_routes(
  p_rugby_code text, p_as_of_date date default current_date, p_regulatory_identity_id uuid default null
)
returns table (
  route_id uuid, route_key text, route_type text, classification text, label text, email text, phone text, url text,
  primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if p_rugby_code not in ('union', 'league') then raise exception 'Invalid rugby_code.' using errcode = '22023'; end if;
  if p_regulatory_identity_id is not null and not exists (
    select 1 from public.regulatory_identities where id = p_regulatory_identity_id and rugby_code = p_rugby_code
  ) then
    raise exception 'The given regulatory identity does not belong to the given rugby code.' using errcode = '22023';
  end if;

  return query
  with primary_citation as (
    select distinct on (c.route_id) c.route_id, s.source_key, l.locator_type, l.locator_value
    from public.regulatory_reporting_route_citations c
    join public.regulatory_sources s on s.id = c.source_id
    left join public.regulatory_source_locators l on l.id = c.locator_id
    order by c.route_id, (c.support_role = 'PRIMARY') desc, c.created_at asc
  )
  select r.id, r.route_key, r.route_type, r.classification, r.label, r.email, r.phone, r.url,
    pc.source_key, case when pc.locator_type is not null then pc.locator_type || ': ' || pc.locator_value else null end
  from public.regulatory_reporting_routes r
  left join primary_citation pc on pc.route_id = r.id
  where r.publication_state = 'PUBLISHED' and r.rugby_code = p_rugby_code
    and (r.regulatory_identity_id = p_regulatory_identity_id or r.regulatory_identity_id is null)
    and (r.effective_from is null or r.effective_from <= p_as_of_date)
    and (r.effective_to is null or r.effective_to >= p_as_of_date)
  order by r.classification desc, r.route_type;
end;
$function$;

create or replace function internal.resolve_player_welfare_content_bundle(
  p_rugby_code text, p_as_of_date date default current_date, p_regulatory_identity_id uuid default null, p_audience text default 'GENERAL'
)
returns table (
  content_set_id uuid, section_key text, display_order integer, fact_id uuid, fact_type text, value_type text,
  value_text text, value_integer integer, value_unit text, obligation_level text, body text,
  primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_content_set_id uuid;
begin
  select rc.content_set_id into v_content_set_id
  from internal.resolve_published_regulatory_content(p_rugby_code, 'PLAYER_WELFARE', p_regulatory_identity_id, p_as_of_date) rc;
  if v_content_set_id is null then return; end if;

  return query
  with sections as (
    select sec.id, sec.section_key, sec.display_order, sec.fact_id
    from public.regulatory_content_sections sec where sec.content_set_id = v_content_set_id
  ),
  requested_copy as (select ac.content_section_id, ac.body from public.regulatory_content_section_audience_copy ac where ac.audience = p_audience),
  general_copy as (select ac.content_section_id, ac.body from public.regulatory_content_section_audience_copy ac where ac.audience = 'GENERAL'),
  primary_citation as (
    select distinct on (c.fact_id) c.fact_id, s.source_key, l.locator_type, l.locator_value
    from public.regulatory_fact_citations c
    join public.regulatory_sources s on s.id = c.source_id
    left join public.regulatory_source_locators l on l.id = c.locator_id
    order by c.fact_id, (c.support_role = 'PRIMARY') desc, c.created_at asc
  )
  select v_content_set_id, sections.section_key, sections.display_order, f.id, f.fact_type, f.value_type,
    f.value_text, f.value_integer, f.value_unit, f.obligation_level, coalesce(rq.body, gc.body), pc.source_key,
    case when pc.locator_type is not null then pc.locator_type || ': ' || pc.locator_value else null end
  from sections
  left join public.regulatory_facts f on f.id = sections.fact_id and f.status = 'VERIFIED'
  left join requested_copy rq on rq.content_section_id = sections.id
  left join general_copy gc on gc.content_section_id = sections.id
  left join primary_citation pc on pc.fact_id = f.id
  order by sections.display_order;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. The real context-derivation checkpoint. Every public entry point
--    below calls this first -- it is the ONE place a viewer's real
--    rugby_code/regulatory_identity_id is derived from their actual
--    relationship data, never accepted as a parameter.
-- ---------------------------------------------------------------------

create or replace function internal.regulatory_context_for_team(p_team_id uuid)
returns table (rugby_code text, regulatory_identity_id uuid, mapping_type text)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_rugby_code text;
  v_team_type_id uuid;
begin
  if not (
    internal.is_site_admin()
    or internal.can_manage_team(p_team_id)
    or exists (
      select 1 from public.player_team_memberships ptm
      where ptm.team_id = p_team_id and ptm.status = 'active'
        and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
    )
  ) then
    raise exception 'You are not authorized to view this team''s regulatory context.' using errcode = '42501';
  end if;

  select t.rugby_code, t.canonical_team_type_id into v_rugby_code, v_team_type_id
  from public.teams t where t.id = p_team_id;

  if v_rugby_code is null then
    raise exception 'Team not found.';
  end if;

  return query
  select v_rugby_code, ri.id, ri.mapping_type
  from public.regulatory_identities ri
  where ri.ovalball_canonical_team_type_id = v_team_type_id;
  -- Zero rows here (no matching regulatory_identities row at all) is a
  -- real, distinct, honest state -- "not yet mapped" -- never conflated
  -- with a mapping_type='NO_DIRECT_MAPPING' row (a real identity that has
  -- been explicitly reviewed and found to have no regulatory equivalent).
  -- The caller (get_rugby_hub_identity_context) returns both shapes
  -- distinguishably: no row at all vs. a row with mapping_type set.
end;
$function$;

comment on function internal.regulatory_context_for_team is 'THE security-hardening fix Side Project 3''s own docs flagged as required before production: derives rugby_code/regulatory_identity_id server-side from a real, authorized relationship to p_team_id -- never accepted as a client-supplied parameter. Every public.get_rugby_hub_* function below calls this (or its public wrapper) first.';

-- ---------------------------------------------------------------------
-- 3. Public entry points -- the ONLY functions Rugby Hub pages call.
--    Every one takes a real team_id (a stable, authorization-checked Main
--    identifier the viewer picks from their own real team list), never a
--    raw rugby_code or regulatory identity.
-- ---------------------------------------------------------------------

create or replace function public.get_rugby_hub_identity_context(p_team_id uuid)
returns table (rugby_code text, regulatory_identity_id uuid, mapping_type text)
language sql stable security definer set search_path to 'public'
as $function$
  select * from internal.regulatory_context_for_team(p_team_id);
$function$;
comment on function public.get_rugby_hub_identity_context is 'What a Rugby Hub page checks FIRST: whether this team''s regulatory identity is DIRECT/DERIVED_COMPOSITE (content may exist), NO_DIRECT_MAPPING (a real, reviewed "no regulatory equivalent" state), or unresolved (no regulatory_identities row yet maps this team type at all) -- three distinct bounded states, never collapsed.';

create or replace function public.get_rugby_hub_rules(p_team_id uuid, p_as_of_date date default current_date, p_competition_overlay_id uuid default null)
returns table (
  content_set_id uuid, section_key text, fact_id uuid, fact_key text, fact_type text, value_type text,
  value_integer integer, value_decimal numeric, value_boolean boolean, value_duration_minutes integer,
  value_distance_metres numeric, value_range_min numeric, value_range_max numeric, value_enum text, value_text text, value_unit text,
  is_overlay boolean, primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rugby_code text; v_identity_id uuid; v_mapping_type text;
begin
  select rugby_code, regulatory_identity_id, mapping_type into v_rugby_code, v_identity_id, v_mapping_type
  from internal.regulatory_context_for_team(p_team_id);

  if v_rugby_code is null or v_identity_id is null or v_mapping_type = 'NO_DIRECT_MAPPING' then
    return;
  end if;

  return query select * from internal.resolve_age_grade_rule_bundle(v_rugby_code, v_identity_id, p_as_of_date, p_competition_overlay_id);
end;
$function$;

create or replace function public.get_rugby_hub_safeguarding_content(p_team_id uuid, p_as_of_date date default current_date, p_audience text default 'GENERAL')
returns table (
  content_set_id uuid, section_key text, display_order integer, fact_id uuid, fact_type text, value_type text,
  value_text text, value_boolean boolean, body text, primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rugby_code text; v_identity_id uuid;
begin
  select rugby_code, regulatory_identity_id into v_rugby_code, v_identity_id from internal.regulatory_context_for_team(p_team_id);
  if v_rugby_code is null then return; end if;
  -- Safeguarding content is not always identity-scoped -- an unresolved/
  -- NO_DIRECT_MAPPING identity does not block general safeguarding
  -- guidance the way it blocks age-grade RULES, so v_identity_id is passed
  -- through as-is (possibly null) rather than short-circuited.
  return query select * from internal.resolve_safeguarding_content_bundle(v_rugby_code, p_as_of_date, v_identity_id, p_audience);
end;
$function$;

create or replace function public.get_rugby_hub_safeguarding_routes(p_team_id uuid, p_as_of_date date default current_date)
returns table (
  route_id uuid, route_key text, route_type text, classification text, label text, email text, phone text, url text,
  primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rugby_code text; v_identity_id uuid;
begin
  select rugby_code, regulatory_identity_id into v_rugby_code, v_identity_id from internal.regulatory_context_for_team(p_team_id);
  if v_rugby_code is null then return; end if;
  return query select * from internal.resolve_safeguarding_reporting_routes(v_rugby_code, p_as_of_date, v_identity_id);
end;
$function$;

create or replace function public.get_rugby_hub_welfare(p_team_id uuid, p_as_of_date date default current_date, p_audience text default 'GENERAL')
returns table (
  content_set_id uuid, section_key text, display_order integer, fact_id uuid, fact_type text, value_type text,
  value_text text, value_integer integer, value_unit text, obligation_level text, body text,
  primary_source_key text, primary_source_locator text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rugby_code text; v_identity_id uuid;
begin
  select rugby_code, regulatory_identity_id into v_rugby_code, v_identity_id from internal.regulatory_context_for_team(p_team_id);
  if v_rugby_code is null then return; end if;
  return query select * from internal.resolve_player_welfare_content_bundle(v_rugby_code, p_as_of_date, v_identity_id, p_audience);
end;
$function$;

-- ---------------------------------------------------------------------
-- 4. Public source-metadata lookup -- safe as designed (non-identity-
--    scoped, only exposes already-implied-public source citation fields
--    that every content resolver's own primary_source_key already
--    reveals). Ported unchanged.
-- ---------------------------------------------------------------------

create or replace function public.resolve_public_source_metadata(p_source_keys text[])
returns table (source_key text, title text, authority_name text, canonical_url text)
language sql stable security definer set search_path to 'public'
as $function$
  select s.source_key, s.title, a.name, s.canonical_url
  from public.regulatory_sources s join public.regulatory_authorities a on a.id = s.authority_id
  where s.source_key = any(p_source_keys);
$function$;

revoke all on function public.get_rugby_hub_identity_context from public, anon;
revoke all on function public.get_rugby_hub_rules from public, anon;
revoke all on function public.get_rugby_hub_safeguarding_content from public, anon;
revoke all on function public.get_rugby_hub_safeguarding_routes from public, anon;
revoke all on function public.get_rugby_hub_welfare from public, anon;
revoke all on function public.resolve_public_source_metadata from public;

grant execute on function public.get_rugby_hub_identity_context to authenticated;
grant execute on function public.get_rugby_hub_rules to authenticated;
grant execute on function public.get_rugby_hub_safeguarding_content to authenticated;
grant execute on function public.get_rugby_hub_safeguarding_routes to authenticated;
grant execute on function public.get_rugby_hub_welfare to authenticated;
grant execute on function public.resolve_public_source_metadata to anon, authenticated;

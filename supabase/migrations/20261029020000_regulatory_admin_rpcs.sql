-- Regulatory content administration RPCs (Rugby Hub Phase 2).
--
-- Ported from ovalball-rugby-knowledge's Stage 2 RPCs (20261101060000-
-- 20261101090000) and Stage 4's reporting-route RPC (20261103020000),
-- audited directly, not copied file-for-file. Every authorization check
-- swapped from SP3's temporary internal.is_regulatory_admin(capability) to
-- Main's real internal.has_capability('site.regulatory.manage', 'site') --
-- SP3's six granular capability strings collapse to Main's single
-- manage_regulatory_content grant (see 20261029000000's own header for why:
-- Main's real site-wide domains never separate view from a single grant).
-- All business logic (season-reset invariant, VERIFIED-requires-PRIMARY-
-- citation-and-no-blocking-source, VERIFIED-is-not-PUBLISHED, etc.) is
-- unchanged from SP3's own tested implementation.

-- ---------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------

create or replace function public.create_regulatory_source(
  p_source_key text, p_authority_id uuid, p_rugby_code text, p_title text, p_source_type text,
  p_authority_classification text, p_canonical_url text, p_retrieved_on date,
  p_landing_page_url text default null, p_document_version text default null, p_publication_date date default null,
  p_effective_from date default null, p_effective_to date default null, p_season_id uuid default null,
  p_geographic_scope text default null, p_competition_scope text default null, p_pathway_scope text default null,
  p_notes text default null, p_provenance_notes text default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to manage regulatory sources.' using errcode = '42501';
  end if;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, landing_page_url, document_version, publication_date, retrieved_on,
    effective_from, effective_to, season_id, geographic_scope, competition_scope, pathway_scope,
    notes, provenance_notes, created_by, updated_by
  ) values (
    p_source_key, p_authority_id, p_rugby_code, p_title, p_source_type, p_authority_classification,
    p_canonical_url, p_landing_page_url, p_document_version, p_publication_date, p_retrieved_on,
    p_effective_from, p_effective_to, p_season_id, p_geographic_scope, p_competition_scope, p_pathway_scope,
    p_notes, p_provenance_notes, auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.set_source_review_state(p_source_id uuid, p_new_state text, p_notes text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to manage regulatory sources.' using errcode = '42501';
  end if;
  if p_new_state not in ('DISCOVERED', 'REVIEW_REQUIRED', 'VERIFIED_CURRENT', 'CONFLICTING', 'SUPERSEDED', 'STALE', 'UNRESOLVED') then
    raise exception 'Invalid source review state: %', p_new_state;
  end if;
  update public.regulatory_sources set review_state = p_new_state, notes = coalesce(p_notes, notes), updated_by = auth.uid(), updated_at = now()
  where id = p_source_id;
  if not found then raise exception 'Regulatory source not found.'; end if;
end;
$function$;

create or replace function public.supersede_regulatory_source(p_old_source_id uuid, p_new_source_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to manage regulatory sources.' using errcode = '42501';
  end if;
  if p_old_source_id = p_new_source_id then raise exception 'A source cannot supersede itself.'; end if;

  update public.regulatory_sources set review_state = 'SUPERSEDED', updated_by = auth.uid(), updated_at = now() where id = p_old_source_id;
  if not found then raise exception 'Old regulatory source not found.'; end if;

  update public.regulatory_sources set supersedes_source_id = p_old_source_id, updated_by = auth.uid(), updated_at = now() where id = p_new_source_id;
  if not found then raise exception 'New regulatory source not found.'; end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- Facts
-- ---------------------------------------------------------------------

create or replace function public.create_regulatory_fact(
  p_fact_key text, p_fact_type text, p_topic text, p_rugby_code text, p_value_type text,
  p_value_integer integer default null, p_value_decimal numeric default null, p_value_boolean boolean default null,
  p_value_duration_minutes integer default null, p_value_distance_metres numeric default null,
  p_value_range_min numeric default null, p_value_range_max numeric default null, p_value_enum text default null,
  p_value_text text default null, p_value_unit text default null, p_subtopic text default null,
  p_season_id uuid default null, p_effective_from date default null, p_effective_to date default null,
  p_notes text default null, p_obligation_level text default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;

  insert into public.regulatory_facts (
    fact_key, fact_type, topic, subtopic, rugby_code, value_type,
    value_integer, value_decimal, value_boolean, value_duration_minutes,
    value_distance_metres, value_range_min, value_range_max, value_enum, value_text, value_unit,
    obligation_level, season_id, effective_from, effective_to, notes, created_by, updated_by
  ) values (
    p_fact_key, p_fact_type, p_topic, p_subtopic, p_rugby_code, p_value_type,
    p_value_integer, p_value_decimal, p_value_boolean, p_value_duration_minutes,
    p_value_distance_metres, p_value_range_min, p_value_range_max, p_value_enum, p_value_text, p_value_unit,
    p_obligation_level, p_season_id, p_effective_from, p_effective_to, p_notes, auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.add_fact_applicability(
  p_fact_id uuid, p_regulatory_identity_id uuid, p_competition_overlay_id uuid default null,
  p_gender_pathway text default null, p_geographic_scope text default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id, competition_overlay_id, gender_pathway, geographic_scope)
  values (p_fact_id, p_regulatory_identity_id, p_competition_overlay_id, p_gender_pathway, p_geographic_scope)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.add_fact_citation(
  p_fact_id uuid, p_source_id uuid, p_support_role text, p_locator_id uuid default null, p_verification_notes text default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_fact_citations (fact_id, source_id, locator_id, support_role, verification_notes, created_by)
  values (p_fact_id, p_source_id, p_locator_id, p_support_role, p_verification_notes, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.verify_regulatory_fact(p_fact_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_citation_count integer; v_blocking_source_count integer; v_open_conflict_count integer;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to verify regulatory content.' using errcode = '42501';
  end if;

  select count(*) into v_citation_count from public.regulatory_fact_citations where fact_id = p_fact_id and support_role = 'PRIMARY';
  if v_citation_count = 0 then
    raise exception 'A fact requires at least one PRIMARY citation before it can be verified.' using errcode = '22023';
  end if;

  select count(*) into v_blocking_source_count
  from public.regulatory_fact_citations c join public.regulatory_sources s on s.id = c.source_id
  where c.fact_id = p_fact_id and s.review_state in ('CONFLICTING', 'STALE', 'UNRESOLVED');
  if v_blocking_source_count > 0 then
    raise exception 'This fact cites a source in a blocking review state (CONFLICTING, STALE, or UNRESOLVED) and cannot be verified until that is resolved.' using errcode = '22023';
  end if;

  select count(*) into v_open_conflict_count
  from public.regulatory_conflict_facts cf join public.regulatory_conflicts c on c.id = cf.conflict_id
  where cf.fact_id = p_fact_id and c.review_state = 'OPEN';
  if v_open_conflict_count > 0 then
    raise exception 'This fact has an open regulatory conflict and cannot be verified until it is resolved.' using errcode = '22023';
  end if;

  update public.regulatory_facts set status = 'VERIFIED', verified_by = auth.uid(), verified_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_fact_id;
  if not found then raise exception 'Regulatory fact not found.'; end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- Conflicts
-- ---------------------------------------------------------------------

create or replace function public.create_regulatory_conflict(
  p_conflict_key text, p_topic text, p_description text, p_rugby_code text default null, p_affected_regulatory_identity_id uuid default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_conflicts (conflict_key, topic, rugby_code, affected_regulatory_identity_id, description, created_by)
  values (p_conflict_key, p_topic, p_rugby_code, p_affected_regulatory_identity_id, p_description, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.link_conflict_source(p_conflict_id uuid, p_source_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_conflict_sources (conflict_id, source_id) values (p_conflict_id, p_source_id) on conflict do nothing;
end;
$function$;

create or replace function public.link_conflict_fact(p_conflict_id uuid, p_fact_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_conflict_facts (conflict_id, fact_id) values (p_conflict_id, p_fact_id) on conflict do nothing;
end;
$function$;

create or replace function public.resolve_regulatory_conflict(p_conflict_id uuid, p_resolution_notes text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to resolve regulatory conflicts.' using errcode = '42501';
  end if;
  if p_resolution_notes is null or trim(p_resolution_notes) = '' then
    raise exception 'Resolution notes are required to resolve a regulatory conflict.';
  end if;
  update public.regulatory_conflicts
  set review_state = 'RESOLVED', resolution_notes = p_resolution_notes, resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
  where id = p_conflict_id and review_state = 'OPEN';
  if not found then raise exception 'Open regulatory conflict not found (it may already be resolved).'; end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- Content sets / sections / publication lifecycle
-- ---------------------------------------------------------------------

create or replace function public.create_regulatory_content_set(
  p_content_set_key text, p_rugby_code text, p_topic text, p_regulatory_identity_id uuid default null,
  p_season_id uuid default null, p_effective_from date default null, p_effective_to date default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, season_id, effective_from, effective_to, created_by, updated_by)
  values (p_content_set_key, p_rugby_code, p_topic, p_regulatory_identity_id, p_season_id, p_effective_from, p_effective_to, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.add_content_section(p_content_set_id uuid, p_section_key text, p_display_order integer default 0, p_fact_id uuid default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (p_content_set_id, p_section_key, p_display_order, p_fact_id)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.set_content_section_audience_copy(p_content_section_id uuid, p_audience text, p_body text)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_content_section_audience_copy (content_section_id, audience, body, created_by, updated_by)
  values (p_content_section_id, p_audience, p_body, auth.uid(), auth.uid())
  on conflict (content_section_id, audience) do update set body = excluded.body, updated_by = auth.uid(), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.verify_regulatory_content_set(p_content_set_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_unverified_fact_count integer;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to verify regulatory content.' using errcode = '42501';
  end if;

  select count(*) into v_unverified_fact_count
  from public.regulatory_content_sections sec join public.regulatory_facts f on f.id = sec.fact_id
  where sec.content_set_id = p_content_set_id and f.status <> 'VERIFIED';
  if v_unverified_fact_count > 0 then
    raise exception 'This content set references % fact(s) that are not yet VERIFIED.', v_unverified_fact_count using errcode = '22023';
  end if;

  update public.regulatory_content_sets
  set publication_state = 'VERIFIED', verified_by = auth.uid(), verified_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_content_set_id and publication_state = 'DRAFT';
  if not found then raise exception 'Content set not found, or not in DRAFT state.'; end if;
end;
$function$;

create or replace function public.publish_regulatory_content_set(p_content_set_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to publish regulatory content.' using errcode = '42501';
  end if;
  update public.regulatory_content_sets
  set publication_state = 'PUBLISHED', published_by = auth.uid(), published_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_content_set_id and publication_state = 'VERIFIED';
  if not found then raise exception 'Content set not found, or not in VERIFIED state (a content set must be VERIFIED before it can be PUBLISHED).'; end if;
end;
$function$;

create or replace function public.supersede_regulatory_content_set(p_old_content_set_id uuid, p_new_content_set_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to supersede regulatory content.' using errcode = '42501';
  end if;
  if p_old_content_set_id = p_new_content_set_id then raise exception 'A content set cannot supersede itself.'; end if;

  update public.regulatory_content_sets set publication_state = 'SUPERSEDED', updated_by = auth.uid(), updated_at = now() where id = p_old_content_set_id;
  if not found then raise exception 'Old content set not found.'; end if;

  update public.regulatory_content_sets set supersedes_content_set_id = p_old_content_set_id, updated_by = auth.uid(), updated_at = now() where id = p_new_content_set_id;
  if not found then raise exception 'New content set not found.'; end if;
end;
$function$;

create or replace function public.copy_regulatory_content_set_to_season(p_content_set_id uuid, p_new_season_id uuid, p_new_content_set_key text)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_source public.regulatory_content_sets; v_new_id uuid; v_section record; v_new_section_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;

  select * into v_source from public.regulatory_content_sets where id = p_content_set_id;
  if not found then raise exception 'Source content set not found.'; end if;

  -- The season-reset invariant: publication_state hardcoded to DRAFT and
  -- every verification/publication timestamp omitted, unconditionally --
  -- a PUBLISHED 2026/27 set can never silently produce an already-
  -- PUBLISHED 2027/28 set.
  insert into public.regulatory_content_sets (
    content_set_key, rugby_code, topic, regulatory_identity_id, season_id,
    effective_from, effective_to, publication_state, version, created_by, updated_by
  ) values (
    p_new_content_set_key, v_source.rugby_code, v_source.topic, v_source.regulatory_identity_id, p_new_season_id,
    null, null, 'DRAFT', 1, auth.uid(), auth.uid()
  ) returning id into v_new_id;

  for v_section in select * from public.regulatory_content_sections where content_set_id = p_content_set_id loop
    insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
    values (v_new_id, v_section.section_key, v_section.display_order, v_section.fact_id)
    returning id into v_new_section_id;

    insert into public.regulatory_content_section_audience_copy (content_section_id, audience, body, created_by, updated_by)
    select v_new_section_id, audience, body, auth.uid(), auth.uid()
    from public.regulatory_content_section_audience_copy where content_section_id = v_section.id;
  end loop;

  return v_new_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- Reporting routes
-- ---------------------------------------------------------------------

create or replace function public.create_regulatory_reporting_route(
  p_route_key text, p_rugby_code text, p_authority_id uuid, p_route_type text, p_label text,
  p_classification text default 'NON_EMERGENCY', p_email text default null, p_phone text default null, p_url text default null,
  p_regulatory_identity_id uuid default null, p_geographic_scope text default null, p_season_id uuid default null,
  p_effective_from date default null, p_effective_to date default null, p_notes text default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_reporting_routes (
    route_key, rugby_code, authority_id, regulatory_identity_id, route_type, classification, label, email, phone, url,
    geographic_scope, season_id, effective_from, effective_to, notes, created_by, updated_by
  ) values (
    p_route_key, p_rugby_code, p_authority_id, p_regulatory_identity_id, p_route_type, p_classification, p_label, p_email, p_phone, p_url,
    p_geographic_scope, p_season_id, p_effective_from, p_effective_to, p_notes, auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.verify_regulatory_reporting_route(p_route_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_citation_count integer; v_blocking_source_count integer;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to verify regulatory content.' using errcode = '42501';
  end if;

  select count(*) into v_citation_count from public.regulatory_reporting_route_citations where route_id = p_route_id and support_role = 'PRIMARY';
  if v_citation_count = 0 then
    raise exception 'A reporting route requires at least one PRIMARY citation before it can be verified.' using errcode = '22023';
  end if;

  select count(*) into v_blocking_source_count
  from public.regulatory_reporting_route_citations c join public.regulatory_sources s on s.id = c.source_id
  where c.route_id = p_route_id and s.review_state in ('CONFLICTING', 'STALE', 'UNRESOLVED');
  if v_blocking_source_count > 0 then
    raise exception 'This route cites a source in a blocking review state and cannot be verified until that is resolved.' using errcode = '22023';
  end if;

  update public.regulatory_reporting_routes set publication_state = 'VERIFIED', verified_by = auth.uid(), verified_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_route_id and publication_state = 'DRAFT';
  if not found then raise exception 'Reporting route not found, or not in DRAFT state.'; end if;
end;
$function$;

create or replace function public.publish_regulatory_reporting_route(p_route_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to publish regulatory content.' using errcode = '42501';
  end if;
  update public.regulatory_reporting_routes set publication_state = 'PUBLISHED', published_by = auth.uid(), published_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_route_id and publication_state = 'VERIFIED';
  if not found then raise exception 'Reporting route not found, or not in VERIFIED state.'; end if;
end;
$function$;

create or replace function public.add_reporting_route_citation(p_route_id uuid, p_source_id uuid, p_support_role text, p_locator_id uuid default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to edit regulatory content.' using errcode = '42501';
  end if;
  insert into public.regulatory_reporting_route_citations (route_id, source_id, locator_id, support_role, created_by)
  values (p_route_id, p_source_id, p_locator_id, p_support_role, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.create_regulatory_source from public, anon;
revoke all on function public.set_source_review_state from public, anon;
revoke all on function public.supersede_regulatory_source from public, anon;
revoke all on function public.create_regulatory_fact from public, anon;
revoke all on function public.add_fact_applicability from public, anon;
revoke all on function public.add_fact_citation from public, anon;
revoke all on function public.verify_regulatory_fact from public, anon;
revoke all on function public.create_regulatory_conflict from public, anon;
revoke all on function public.link_conflict_source from public, anon;
revoke all on function public.link_conflict_fact from public, anon;
revoke all on function public.resolve_regulatory_conflict from public, anon;
revoke all on function public.create_regulatory_content_set from public, anon;
revoke all on function public.add_content_section from public, anon;
revoke all on function public.set_content_section_audience_copy from public, anon;
revoke all on function public.verify_regulatory_content_set from public, anon;
revoke all on function public.publish_regulatory_content_set from public, anon;
revoke all on function public.supersede_regulatory_content_set from public, anon;
revoke all on function public.copy_regulatory_content_set_to_season from public, anon;
revoke all on function public.create_regulatory_reporting_route from public, anon;
revoke all on function public.verify_regulatory_reporting_route from public, anon;
revoke all on function public.publish_regulatory_reporting_route from public, anon;
revoke all on function public.add_reporting_route_citation from public, anon;

grant execute on function public.create_regulatory_source to authenticated;
grant execute on function public.set_source_review_state to authenticated;
grant execute on function public.supersede_regulatory_source to authenticated;
grant execute on function public.create_regulatory_fact to authenticated;
grant execute on function public.add_fact_applicability to authenticated;
grant execute on function public.add_fact_citation to authenticated;
grant execute on function public.verify_regulatory_fact to authenticated;
grant execute on function public.create_regulatory_conflict to authenticated;
grant execute on function public.link_conflict_source to authenticated;
grant execute on function public.link_conflict_fact to authenticated;
grant execute on function public.resolve_regulatory_conflict to authenticated;
grant execute on function public.create_regulatory_content_set to authenticated;
grant execute on function public.add_content_section to authenticated;
grant execute on function public.set_content_section_audience_copy to authenticated;
grant execute on function public.verify_regulatory_content_set to authenticated;
grant execute on function public.publish_regulatory_content_set to authenticated;
grant execute on function public.supersede_regulatory_content_set to authenticated;
grant execute on function public.copy_regulatory_content_set_to_season to authenticated;
grant execute on function public.create_regulatory_reporting_route to authenticated;
grant execute on function public.verify_regulatory_reporting_route to authenticated;
grant execute on function public.publish_regulatory_reporting_route to authenticated;
grant execute on function public.add_reporting_route_citation to authenticated;

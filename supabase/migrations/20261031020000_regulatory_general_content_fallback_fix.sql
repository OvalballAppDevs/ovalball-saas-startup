-- Fixes a second real, latent gap in internal.resolve_published_regulatory_
-- content (20261029030000_regulatory_resolvers.sql), exposed by the same
-- Phase 3 real-content import as 20261031010000's rugby_code fix.
--
-- The schema deliberately supports BOTH identity-scoped content sets
-- (regulatory_identity_id not null -- e.g. RFU-PLAYER-WELFARE-ELITE-2026,
-- scoped to RFU-PREM-CHAMP-PWR) and general, identity-unscoped ones
-- (regulatory_identity_id null -- e.g. RFU-PLAYER-WELFARE-COMMUNITY-2026,
-- RFL-SAFEGUARDING-2026-GENERAL), by design (regulatory_content_sets'
-- own migration comment: "most safeguarding content is not age-specific").
-- But the original matching condition --
--   (s.regulatory_identity_id = p_regulatory_identity_id
--     or (s.regulatory_identity_id is null and p_regulatory_identity_id is null))
-- -- only ever matches general content when the CALLER's own resolved
-- identity is ALSO null. In practice a real team almost always resolves to
-- SOME regulatory identity (Phase 3's own RFL-GIRLS-U12 team, DIRECT), so
-- general content became permanently unreachable for exactly the teams it
-- was written for -- live UAT against a real Girls U12 league guardian
-- account caught this directly (the Safeguarding page showed "being
-- reviewed" for content that is genuinely PUBLISHED).
--
-- Fixed with an explicit two-tier precedence: an identity-EXACT match
-- (most specific) wins if one exists; otherwise fall back to general
-- (identity-unscoped) content. This preserves the existing behaviour for
-- RULES (always identity-scoped, tier 1 only, never falls back) and for
-- the already-passing regression suite (whose own fixture identity has no
-- content of its own either way), while making general SAFEGUARDING/
-- PLAYER_WELFARE content reachable by any team of the matching rugby_code
-- that doesn't have a more specific identity-scoped variant. The
-- "ambiguous published content" safety check is preserved independently
-- within each tier, never collapsed across tiers.

create or replace function internal.resolve_published_regulatory_content(
  p_rugby_code text, p_topic text, p_regulatory_identity_id uuid, p_as_of_date date default current_date
)
returns table (
  content_set_id uuid, content_set_key text, regulatory_identity_id uuid, season_id uuid,
  effective_from date, effective_to date, version integer, published_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_specific_count integer; v_general_count integer;
begin
  if p_rugby_code not in ('union', 'league') then raise exception 'Invalid rugby_code.' using errcode = '22023'; end if;
  if p_topic not in ('RULES', 'SAFEGUARDING', 'PLAYER_WELFARE') then raise exception 'Invalid topic.' using errcode = '22023'; end if;
  if p_regulatory_identity_id is not null and not exists (
    select 1 from public.regulatory_identities where id = p_regulatory_identity_id and rugby_code = p_rugby_code
  ) then
    raise exception 'The given regulatory identity does not belong to the given rugby code.' using errcode = '22023';
  end if;

  -- Tier 1: a content set scoped to exactly this identity (most specific).
  if p_regulatory_identity_id is not null then
    select count(*) into v_specific_count
    from public.regulatory_content_sets s
    where s.publication_state = 'PUBLISHED' and s.rugby_code = p_rugby_code and s.topic = p_topic
      and s.regulatory_identity_id = p_regulatory_identity_id
      and (s.effective_from is null or s.effective_from <= p_as_of_date)
      and (s.effective_to is null or s.effective_to >= p_as_of_date);

    if v_specific_count > 1 then
      raise exception 'Ambiguous published content: % overlapping identity-scoped PUBLISHED content sets cover % for this rugby_code/topic/identity. Must be resolved by an authorized regulatory admin, not guessed.', v_specific_count, p_as_of_date using errcode = '22023';
    end if;

    if v_specific_count = 1 then
      return query
      select s.id, s.content_set_key, s.regulatory_identity_id, s.season_id, s.effective_from, s.effective_to, s.version, s.published_at
      from public.regulatory_content_sets s
      where s.publication_state = 'PUBLISHED' and s.rugby_code = p_rugby_code and s.topic = p_topic
        and s.regulatory_identity_id = p_regulatory_identity_id
        and (s.effective_from is null or s.effective_from <= p_as_of_date)
        and (s.effective_to is null or s.effective_to >= p_as_of_date);
      return;
    end if;
  end if;

  -- Tier 2: no identity-specific content set exists (or the caller has no
  -- resolved identity at all) -- fall back to general, identity-unscoped
  -- content for this rugby_code/topic, if any.
  select count(*) into v_general_count
  from public.regulatory_content_sets s
  where s.publication_state = 'PUBLISHED' and s.rugby_code = p_rugby_code and s.topic = p_topic
    and s.regulatory_identity_id is null
    and (s.effective_from is null or s.effective_from <= p_as_of_date)
    and (s.effective_to is null or s.effective_to >= p_as_of_date);

  if v_general_count > 1 then
    raise exception 'Ambiguous published content: % overlapping general PUBLISHED content sets cover % for this rugby_code/topic. Must be resolved by an authorized regulatory admin, not guessed.', v_general_count, p_as_of_date using errcode = '22023';
  end if;

  return query
  select s.id, s.content_set_key, s.regulatory_identity_id, s.season_id, s.effective_from, s.effective_to, s.version, s.published_at
  from public.regulatory_content_sets s
  where s.publication_state = 'PUBLISHED' and s.rugby_code = p_rugby_code and s.topic = p_topic
    and s.regulatory_identity_id is null
    and (s.effective_from is null or s.effective_from <= p_as_of_date)
    and (s.effective_to is null or s.effective_to >= p_as_of_date);
end;
$function$;

comment on function internal.resolve_published_regulatory_content is 'Resolves the one PUBLISHED content set covering a rugby_code/topic/identity/date, with two-tier precedence: an identity-exact match wins if one exists, otherwise general (identity-unscoped) content is used as a fallback. Ambiguity (more than one match) is rejected independently within each tier, never guessed at.';

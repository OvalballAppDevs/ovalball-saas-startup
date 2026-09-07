-- Fixes a real, latent gap in internal.regulatory_context_for_team
-- (20261029030000_regulatory_resolvers.sql), only exposed once Phase 3
-- populated real regulatory_identities rows: Main's canonical_team_types
-- catalogue is deliberately rugby-code-agnostic (a team's own rugby_code
-- lives on public.teams, not on canonical_team_types), so the SAME
-- canonical_team_type_id (e.g. 'girls_u12') can legitimately be used by
-- both a union team and a league team. The resolver's own join only
-- matched on ovalball_canonical_team_type_id, so a real team could
-- resolve to a regulatory_identities row of the WRONG rugby_code whenever
-- two identities (one union, one league) happened to share a team type --
-- exactly what supabase/tests/regulatory_content_administration.sql's own
-- synthetic RFU-GIRLS-U12-RCA identity and this migration's real
-- RFL-GIRLS-U12 identity both do, both keyed off canonical_team_types.
-- 'girls_u12'. internal.resolve_published_regulatory_content already
-- guards against exactly this mismatch with its own runtime check ("The
-- given regulatory identity does not belong to the given rugby code"),
-- which is what caught this in regression -- the real fix belongs
-- upstream, in the resolver that derives the identity in the first place.

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
  where ri.ovalball_canonical_team_type_id = v_team_type_id
    and ri.rugby_code = v_rugby_code;
  -- rugby_code is now part of the join, not just the return value: the
  -- same canonical_team_type_id can carry a real union identity AND a
  -- real league identity (they are different regulatory registers over
  -- the same age/gender team shape), and a team must only ever resolve
  -- to the one matching its own actual rugby_code.
  --
  -- Zero rows here (no matching regulatory_identities row at all, for
  -- this team's own rugby_code) is a real, distinct, honest state -- "not
  -- yet mapped" -- never conflated with a mapping_type='NO_DIRECT_MAPPING'
  -- row (a real identity that has been explicitly reviewed and found to
  -- have no regulatory equivalent). The caller
  -- (get_rugby_hub_identity_context) returns both shapes distinguishably:
  -- no row at all vs. a row with mapping_type set.
end;
$function$;

comment on function internal.regulatory_context_for_team is 'Derives rugby_code/regulatory_identity_id server-side from a real, authorized relationship to p_team_id -- never accepted as a client-supplied parameter. Matches on BOTH ovalball_canonical_team_type_id AND the team''s own real rugby_code, since the same canonical team type can carry separate union and league regulatory identities. Every public.get_rugby_hub_* function calls this (or its public wrapper) first.';

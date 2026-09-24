-- ===========================================================================
-- A CLUB CREATES A TEAM IN ONE OPERATION (CA-M2)
-- ===========================================================================
--
-- The website created a club team with the only direct INSERT into `public.teams` in the whole
-- application (app/(app)/teams/actions.ts): it looked the chosen catalogue entry up BY ITS LABEL,
-- resolved the structured fields in TypeScript, and inserted them with placeholder names for the
-- triggers to overwrite. Authority was the row policy alone (`teams_insert_admin` =
-- team.team.manage or site.team_roles.manage, plus a non-null canonical type set by the trigger).
-- A second client would have had to copy the label lookup and the field resolution.
--
-- OWNER DECISION 3 -- DOMAIN OPERATION FIRST. `create_club_team` takes the canonical identity by
-- its stable KEY (`canonical_team_types.key`, e.g. u12, girls_u14, mens_1st) and an optional
-- additional-squad letter, and it decides the structured fields itself from the catalogue row --
-- so neither client resolves an age grade, a pathway or a code from a label, ever. The club's
-- rugby code is the Club Directory's, never the caller's. The identity must be offered for that
-- code (`canonical_team_types_by_code.is_offered`), which the INSERT trigger also enforces.
--
-- The triggers on `teams` remain the authority for everything downstream: the display name and slug
-- are derived (`teams_set_display_name_trigger`), the canonical type is pinned
-- (`teams_set_canonical_type_trigger`), squad structure is validated, and the row is audited
-- (`audit_row_change`). Nothing here names an age grade.
--
-- Forward-only. No data changed. The row policy stays as the floor.
-- ===========================================================================

create or replace function public.create_club_team(
  p_club_id uuid,
  p_canonical_team_type_key text,
  p_squad_letter text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
  v_type public.canonical_team_types;
  v_offered boolean;
  v_squad text;
  v_letter text := nullif(upper(btrim(coalesce(p_squad_letter, ''))), '');
  v_id uuid;
begin
  if p_club_id is null then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not (internal.can('team.team.manage', 'club', p_club_id, null, null) or internal.has_site_capability('site.team_roles.manage')) then
    raise exception 'You do not have permission to add teams at this club.' using errcode = '42501';
  end if;

  -- THE CLUB'S CODE IS THE DIRECTORY'S. Never taken from the caller.
  select d.rugby_code into v_code
  from public.clubs c join public.club_directory d on d.id = c.directory_id
  where c.id = p_club_id;
  if v_code not in ('union', 'league') then
    raise exception 'This club''s rugby code is not recorded.' using errcode = '22023';
  end if;

  select * into v_type from public.canonical_team_types t where t.key = p_canonical_team_type_key;
  if v_type.id is null then
    raise exception 'Unrecognised team. Pick one from the Team Directory.' using errcode = '22023';
  end if;
  select coalesce(bool_or(v.is_offered), false) into v_offered
  from public.canonical_team_types_by_code v
  where v.key = p_canonical_team_type_key and v.rugby_code = v_code;
  if not v_type.is_active or not v_offered then
    raise exception 'That team is not offered for this club''s rugby code.' using errcode = '22023';
  end if;

  -- The squad: a senior identity carries its own ordinal; a youth identity may add a B or C squad
  -- when the catalogue allows squads; nothing else is a squad letter.
  if v_type.fixed_squad_designation is not null then
    v_squad := v_type.fixed_squad_designation;
    if v_letter is not null then
      raise exception 'That team does not take a squad letter.' using errcode = '22023';
    end if;
  elsif v_letter is not null then
    if not v_type.allows_squads or v_letter not in ('B', 'C') then
      raise exception 'Only a B or C squad can be added to that team.' using errcode = '22023';
    end if;
    v_squad := v_letter;
  else
    v_squad := null;
  end if;

  insert into public.teams (club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug, created_by, updated_by)
  values (p_club_id, v_code, v_type.category, v_type.age_group, v_squad, v_type.gender, 'pending', 'pending', auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'This club already has that team. If it was folded, reactivate it rather than adding it again.' using errcode = '23505';
end;
$function$;

comment on function public.create_club_team(uuid, text, text) is
  'Add a team to a club by its canonical Team Directory key (and optional B/C squad letter). Requires team.team.manage at the club or site.team_roles.manage. The club''s rugby code comes from the Club Directory; the identity must be offered for it; every downstream field (name, slug, canonical type) is derived by the teams triggers. Audited by the teams row trigger.';

revoke execute on function public.create_club_team(uuid, text, text) from public, anon;
grant execute on function public.create_club_team(uuid, text, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.create_club_team(uuid, text, text)', 'EXECUTE') then
    raise exception 'create_club_team must not be executable by anon';
  end if;
  -- the lifecycle operations already ask the canonical capability, not a role; pin that here so
  -- a later change cannot quietly reintroduce a role check
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fold_team' and p.prosrc ~ 'team\.lifecycle\.manage')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reactivate_team' and p.prosrc ~ 'team\.lifecycle\.manage') then
    raise exception 'fold_team and reactivate_team must authorise on team.lifecycle.manage';
  end if;
end $$;

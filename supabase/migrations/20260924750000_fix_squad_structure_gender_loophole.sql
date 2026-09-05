-- Same NULL-gender loophole as teams_active_canonical_identity_idx
-- (previous migration), found live while testing the new unique index:
-- internal.validate_team_squad_structure() links a B/C squad to its
-- primary team using `gender is not distinct from`, matching the exact
-- same fragile pattern the uniqueness index just moved away from. A real
-- primary whose gender is NULL (a legacy/incomplete row) and a B/C squad
-- whose gender is populated (or vice versa) would fail to match even
-- though canonical_team_type_id + squad_designation already prove they
-- belong to the same club + age-grade identity -- this would have
-- incorrectly blocked activating a B/C squad, or incorrectly allowed
-- deactivating a primary out from under an active B/C squad, purely
-- because of a mutable display field neither check actually needs.
-- canonical_team_type_id (paired with squad_designation) is the correct,
-- stable identity to match on -- gender is redundant here exactly as it
-- was for the uniqueness index.
create or replace function internal.validate_team_squad_structure()
returns trigger
language plpgsql
as $function$
declare
  v_has_active_primary boolean;
  v_has_active_squad boolean;
begin
  if new.active and new.category = 'youth' and new.squad_designation in ('B', 'C') then
    select exists(
      select 1 from public.teams p
      where p.club_id = new.club_id
        and p.canonical_team_type_id = new.canonical_team_type_id
        and p.squad_designation is null
        and p.active = true
        and p.id <> new.id
    ) into v_has_active_primary;
    if not v_has_active_primary then
      raise exception 'Cannot activate a % squad without an active primary team at this level.', new.squad_designation
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.active = true and new.active = false
     and old.category = 'youth' and old.squad_designation is null then
    select exists(
      select 1 from public.teams s
      where s.club_id = old.club_id
        and s.canonical_team_type_id = old.canonical_team_type_id
        and s.squad_designation in ('B', 'C')
        and s.active = true
    ) into v_has_active_squad;
    if v_has_active_squad then
      raise exception 'Cannot deactivate the primary team while a B or C squad at this level is still active. Deactivate those first.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

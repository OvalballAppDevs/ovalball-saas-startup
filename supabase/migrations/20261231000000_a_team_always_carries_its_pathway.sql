-- A team cannot exist without saying which pathway it plays in.
--
-- WHAT WAS ON SCREEN
--
-- Club Admin -> Teams listed "Under 13" between "Under 12 Boys" and "Under 14
-- Girls". Not a rendering bug: teams.gender was NULL on that row, and the
-- display name is derived from the team's own fields, so there was no pathway
-- word to write.
--
-- The part that makes it a single-source-of-truth failure rather than missing
-- data: the team's canonical identity ALREADY said boys. canonical_team_type_id
-- pointed at u13, whose gender is 'boys'. The directory knew, the team row did
-- not, and the two were allowed to disagree.
--
-- HOW IT WAS POSSIBLE
--
-- internal.teams_set_canonical_type resolves the canonical identity FROM the
-- team's fields, and internal.resolve_canonical_team_type tolerates a missing
-- gender: with none supplied it falls through to sort_order and returns the
-- boys identity. So the identity was resolved correctly and the field that
-- produced it was left empty, permanently.
--
-- THE RULE
--
-- Below U12 there is only one legal answer -- mixed rugby is the only thing
-- played there, and the check constraint on teams already says so -- so a
-- missing pathway is filled in rather than argued about.
--
-- From U12 the pathway genuinely branches, and there is no honest default.
-- Guessing "boys" because it sorts first is exactly the assumption Ovalball
-- refuses to make about a player, and a team is no different. So it is
-- refused, with a message that says what to do.
--
-- Senior rugby is the same: men's and women's are different teams.

create or replace function internal.teams_set_canonical_type()
returns trigger
language plpgsql
as $function$
declare v_mini boolean;
begin
  v_mini := new.category = 'youth'
    and new.age_group in ('U6','U7','U8','U9','U10','U11');

  -- Mini rugby is mixed, and that is the only value the constraint permits
  -- there, so an absent pathway is completed rather than rejected.
  if new.gender is null and v_mini then
    new.gender := 'mixed';
  end if;

  if new.gender is null and new.category = 'youth' and not v_mini then
    raise exception 'An Under-12 or older team plays in the boys'' or the girls'' pathway, and Ovalball will not choose for you. Set the pathway on this team.'
      using errcode = '23514';
  end if;

  if new.gender is null and new.category = 'senior' then
    raise exception 'A senior team is a men''s or a women''s side. Set which one.'
      using errcode = '23514';
  end if;

  new.canonical_team_type_id := internal.resolve_canonical_team_type(
    new.category, new.age_group, new.gender, new.squad_designation);

  -- And the row is made to agree with the identity it resolved to, so the
  -- Team Directory and a club's own team can never describe the same side
  -- differently again. Colts carry no gender by design.
  if new.canonical_team_type_id is not null then
    new.gender := coalesce(
      (select ctt.gender from public.canonical_team_types ctt where ctt.id = new.canonical_team_type_id),
      new.gender);
  end if;

  return new;
end;
$function$;

comment on function internal.teams_set_canonical_type() is
  'Resolves a team''s canonical identity and then makes the team row agree with it. A youth team from U12 up, or any senior team, must state its pathway -- Ovalball will not pick one because it sorts first.';

-- ---------------------------------------------------------------------------
-- The rows already on screen
-- ---------------------------------------------------------------------------
--
-- No guessing needed: every one of these already points at a canonical
-- identity that records the pathway. This copies the answer the directory
-- always had onto the team that was missing it, which is why it is safe.

do $$
declare v_fixed int; r record;
begin
  for r in
    select t.id, t.display_name, ctt.gender as canonical_gender, ctt.label
    from public.teams t
    join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
    where t.gender is null and ctt.gender is not null
  loop
    raise notice '  % had no pathway; its canonical identity (%) says %.', r.display_name, r.label, r.canonical_gender;
  end loop;

  update public.teams t
  set gender = ctt.gender
  from public.canonical_team_types ctt
  where ctt.id = t.canonical_team_type_id
    and t.gender is null and ctt.gender is not null;
  get diagnostics v_fixed = row_count;

  raise notice 'Pathway backfill: % team(s) now carry the pathway their canonical identity already recorded.', v_fixed;
end $$;

do $$
declare v_left int;
begin
  select count(*) into v_left
  from public.teams t
  join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
  where t.active and t.gender is distinct from ctt.gender;
  if v_left > 0 then
    raise exception '% active team(s) still disagree with their own canonical identity about the pathway.', v_left;
  end if;
end $$;

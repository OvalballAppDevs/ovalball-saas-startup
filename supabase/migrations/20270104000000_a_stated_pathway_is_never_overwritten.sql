-- Completing a missing pathway is not the same as overruling a stated one.
--
-- 20261231000000 made a team row agree with the canonical identity it resolves
-- to, which fixed the "Under 13" with no pathway word. It did so by copying the
-- canonical identity's gender onto the row unconditionally, and that went one
-- step too far: a row that STATED a pathway had it quietly rewritten.
--
-- The visible consequence was a team of an identity that does not exist being
-- accepted. `('youth', 'U17', 'mixed')` is not a rugby team -- mixed rugby ends
-- at U11, and the check constraint on teams says exactly that. But
-- resolve_canonical_team_type ignores a gender it cannot match and falls
-- through to the boys identity, so the row was rewritten to U17 boys before the
-- constraint ever saw it, and an invalid team was activated instead of refused.
--
-- The distinction is the whole point:
--
--   gender absent    -> the identity knows the answer; fill it in.
--   gender stated    -> the club has said something. If it disagrees with the
--                       identity that resolved, that is a contradiction to
--                       report, never a value to overwrite.

create or replace function internal.teams_set_canonical_type()
returns trigger
language plpgsql
as $function$
declare
  v_mini boolean;
  v_stated text := new.gender;
  v_canonical_gender text;
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

  if new.canonical_team_type_id is not null then
    select ctt.gender into v_canonical_gender
    from public.canonical_team_types ctt where ctt.id = new.canonical_team_type_id;

    if v_stated is null then
      -- The row never said. The identity did, so the row now carries it and the
      -- Team Directory and the club can no longer describe the same side
      -- differently. Colts carry no gender by design, hence the coalesce.
      new.gender := coalesce(v_canonical_gender, new.gender);
    elsif v_canonical_gender is not null and v_stated is distinct from v_canonical_gender then
      -- The row said something the catalogue does not recognise at this age
      -- grade. Rewriting it would manufacture a team nobody asked for.
      raise exception 'There is no % team at % in the Team Directory. The closest identity Ovalball recognises is the % one, which is a different team.',
        v_stated, coalesce(new.age_group, new.category), v_canonical_gender
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

comment on function internal.teams_set_canonical_type() is
  'Resolves a team''s canonical identity and reconciles the row with it. A missing pathway is completed from the identity; a STATED pathway that disagrees with the identity is refused, never overwritten. A youth team from U12 up, or any senior team, must state its pathway -- Ovalball will not pick one because it sorts first.';

-- The row that started this: still correct, and still correct for the right
-- reason. Re-verified rather than assumed.
do $$
declare v_left int;
begin
  select count(*) into v_left
  from public.teams t
  join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
  where t.active and t.gender is distinct from ctt.gender and ctt.gender is not null;
  if v_left > 0 then
    raise exception '% active team(s) disagree with their own canonical identity about the pathway.', v_left;
  end if;
  raise notice 'Every active team still agrees with its canonical identity.';
end $$;

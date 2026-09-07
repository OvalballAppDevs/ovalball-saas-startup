-- Code-specific team-type availability, replacing a global deactivation that
-- let Union evidence narrow Rugby League.
--
-- WHAT WENT WRONG
--
-- 20261108000000 established from RFU Regulation 15.6 that union girls play in
-- dual age bands, so Girls U13 and Girls U15 are not union age grades. It then
-- enforced that by setting canonical_team_types.is_active = false on both rows.
--
-- canonical_team_types has no rugby_code column. It is one shared catalogue for
-- both codes. So a global deactivation removed those identities from RUGBY
-- LEAGUE surfaces too -- and the RFL's girls age structure has never been
-- established from a primary source. Union evidence was allowed to mutate
-- League availability, which is exactly backwards: absence of research is not
-- evidence of absence, the same principle applied to Appendix 10 earlier.
--
-- The blast radius was wider than the picker, too. internal.
-- validate_canonical_type_active_on_create is a BEFORE INSERT trigger on teams
-- that refuses any team whose canonical type is globally inactive -- so a
-- League club could no longer create a Girls U13 team at all, not merely fail
-- to see it offered.
--
-- WHY regulatory_team_type_mappings IS THE RIGHT HOME
--
-- No new table is needed, and this is not a repurposing. The mapping table's
-- own NOT_OFFERED state was documented at creation (20261104000000) as:
--
--   "Ovalball supports the team type, but not in this code (no such thing as
--    League Colts in the Ovalball catalogue today)."
--
-- That is precisely the semantic required. It already existed, keyed on
-- (canonical_team_type_id, rugby_code), and until now it was documentation
-- that nothing read. This migration wires it to behaviour.
--
-- The rule is deliberately POSITIVE-DEFAULT: a type is offered for a code
-- unless that code's row explicitly says NOT_OFFERED. A missing mapping row, or
-- RESEARCH_REQUIRED, means offered. So unresearched combinations keep working
-- and a Site-Admin-added type appears everywhere immediately -- there is no
-- path by which silence narrows availability.
--
-- Verified before wiring: the ONLY NOT_OFFERED rows in the entire matrix are
-- union/girls_u13 and union/girls_u15. League has none, so turning this state
-- into behaviour changes nothing for League.

-- ============================================================
-- 1. Undo the global deactivation. These are legitimate rows again.
-- ============================================================

update public.canonical_team_types
set is_active = true, updated_at = now()
where key in ('girls_u13', 'girls_u15');

-- ============================================================
-- 2. One place to ask "is this type offered for this code?".
--
--    Every offering surface reads this instead of filtering is_active by
--    hand, so the rule cannot drift between the signup checklist, Add Team,
--    the server action that validates a submission, the tournament picker
--    and opponent search.
-- ============================================================

create view public.canonical_team_types_by_code
with (security_invoker = true)
as
select
  c.code as rugby_code,
  ctt.id,
  ctt.key,
  ctt.label,
  ctt.category,
  ctt.age_group,
  ctt.gender,
  ctt.fixed_squad_designation,
  ctt.allows_squads,
  ctt.sort_order,
  ctt.is_active,
  coalesce(m.mapping_state, 'RESEARCH_REQUIRED') as mapping_state,
  -- Offered = globally active AND not explicitly withheld from this code.
  -- Positive default: no mapping row means offered.
  (ctt.is_active and coalesce(m.mapping_state, '') <> 'NOT_OFFERED') as is_offered
from public.canonical_team_types ctt
cross join (values ('union'), ('league')) as c(code)
left join public.regulatory_team_type_mappings m
  on m.canonical_team_type_id = ctt.id
 and m.rugby_code = c.code;

comment on view public.canonical_team_types_by_code is
  'The canonical team catalogue resolved PER RUGBY CODE. is_offered is the single source of truth for what a club of a given code may be offered as a NEW team identity: globally active, and not marked NOT_OFFERED for that code in regulatory_team_type_mappings. Positive default -- a missing mapping row or RESEARCH_REQUIRED means offered, so unresearched combinations are never silently narrowed. This view does NOT govern whether an EXISTING team resolves; historical rows resolve through canonical_team_types directly and are unaffected by offering rules.';

grant select on public.canonical_team_types_by_code to anon, authenticated;

-- ============================================================
-- 3. The activation guard becomes code-aware.
--
--    Previously it only knew "globally deactivated". It now also refuses a
--    type withheld from the team's OWN code, and -- crucially -- stops
--    refusing types that are merely withheld from the OTHER code.
-- ============================================================

create or replace function internal.validate_canonical_type_active_on_create()
returns trigger
language plpgsql
as $function$
declare
  v_key text;
begin
  if new.active and new.canonical_team_type_id is not null then
    if not exists (select 1 from public.canonical_team_types where id = new.canonical_team_type_id and is_active) then
      raise exception 'This team type has been deactivated by a Site Admin and can no longer be newly activated.' using errcode = '23514';
    end if;

    -- Withheld from this code specifically. Deliberately keyed on the team's
    -- own rugby_code, so a rule established for one code can never block the
    -- other. A team with a null rugby_code is not blocked -- there is no code
    -- to check it against, and inventing one would be worse than allowing it.
    if new.rugby_code is not null and exists (
      select 1 from public.regulatory_team_type_mappings m
      where m.canonical_team_type_id = new.canonical_team_type_id
        and m.rugby_code = new.rugby_code
        and m.mapping_state = 'NOT_OFFERED'
    ) then
      select key into v_key from public.canonical_team_types where id = new.canonical_team_type_id;
      raise exception 'The team type "%" is not offered in % rugby and cannot be created. See regulatory_team_type_mappings for why.', coalesce(v_key, '?'), new.rugby_code
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

comment on function internal.validate_canonical_type_active_on_create() is
  'BEFORE INSERT on teams. Refuses a new active team whose canonical type is either globally deactivated or marked NOT_OFFERED for that team''s OWN rugby_code. Fires on INSERT only, so existing rows -- including any historical team on a type later withheld -- keep working and keep resolving; withholding a type governs what may be CREATED, never what already exists.';

-- ============================================================
-- 4. Prove the invariant this whole migration exists to protect, now and on
--    every future run of the migration set.
-- ============================================================

do $$
declare
  v_bad text;
begin
  -- League must offer everything the global catalogue offers.
  select string_agg(key, ', ' order by key) into v_bad
  from public.canonical_team_types_by_code
  where rugby_code = 'league' and is_active and not is_offered;
  if v_bad is not null then
    raise exception 'Rugby League availability was narrowed (% withheld). No RFL evidence exists to justify that; refusing to apply.', v_bad;
  end if;

  -- Union must withhold exactly the two non-grades, and no others.
  select string_agg(key, ', ' order by key) into v_bad
  from public.canonical_team_types_by_code
  where rugby_code = 'union' and is_active and not is_offered
    and key not in ('girls_u13', 'girls_u15');
  if v_bad is not null then
    raise exception 'Rugby Union withholds unexpected team type(s): %.', v_bad;
  end if;

  -- And the two that should be withheld actually are.
  if exists (
    select 1 from public.canonical_team_types_by_code
    where rugby_code = 'union' and key in ('girls_u13', 'girls_u15') and is_offered
  ) then
    raise exception 'Union girls_u13/girls_u15 are still being offered; RFU Regulation 15.6 says they are not age grades.';
  end if;
end $$;

-- Completion pass Section 18/Team-duplicate-cleanup: at most one ACTIVE
-- team per club + canonical identity + structural squad slot.
--
-- The prior version of this index (teams_active_canonical_identity_idx)
-- keyed on (club_id, canonical_team_type_id, gender, squad_designation).
-- Including gender was the bug: canonical_team_type_id is ALREADY
-- resolved from (category, age_group, gender, squad_designation) via
-- internal.resolve_canonical_team_type(), so it already encodes gender
-- for canonical types that are gender-specific (e.g. senior Men's/Women's,
-- youth boys/girls splits). Keying the uniqueness index on the raw
-- `gender` COLUMN on top of that let two rows sharing the exact same
-- canonical_team_type_id coexist as long as one had gender left NULL and
-- the other had it explicitly set -- live-found for Burnley's real U12
-- and U7 teams (a NULL-gender row alongside a boys-gender row, both
-- resolving to the identical canonical_team_type_id). Dropping gender
-- from the key and trusting the stable canonical id instead closes this
-- exactly, without weakening real distinctions (Men's vs Women's, boys
-- U12 vs girls U12) that genuinely differ by canonical_team_type_id.
--
-- Squad designation stays part of the key so U12 primary / U12 B / U12 C
-- remain three legitimate, independently-active slots -- a club-specific
-- alias (e.g. "U12 Blacks" for the B slot) is a display label only, never
-- a change to squad_designation itself, so it cannot weaken this rule.
drop index if exists public.teams_active_canonical_identity_idx;

create unique index teams_active_canonical_identity_idx
  on public.teams (club_id, canonical_team_type_id, coalesce(squad_designation, ''))
  where active = true and canonical_team_type_id is not null;

comment on index public.teams_active_canonical_identity_idx is 'At most one ACTIVE team per club + canonical identity + squad slot. Deliberately excludes the raw gender column -- canonical_team_type_id already resolves it, and a NULL-vs-set gender split on an otherwise-identical canonical_team_type_id is exactly the duplicate pattern this closes. Folded/inactive rows are untouched (WHERE active=true only), so the normal fold/reactivate/rollover lifecycle for real production teams is unaffected -- this only ever compares currently-active rows.';

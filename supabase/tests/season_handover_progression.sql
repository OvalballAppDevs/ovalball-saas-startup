-- Season handover: ONE canonical progression graph, code- and gender-specific.
--
-- Progression used to be computed in three places and only one knew the rugby
-- code. The automatic transition job used the code-blind successor while the
-- manual button used the code-aware one, so a union Girls U12 cohort would
-- roll to a "U13" identity union does not have. These assertions exist to
-- keep the three paths converged.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare v_count int; v_text text; v_det boolean; v_def text;
begin

-- ============ A. Union male: U16 -> U17 -> U18 -> stop ============

if internal.next_age_grade_for('U15','boys','union') = 'U16'
   and internal.next_age_grade_for('U16','boys','union') = 'U17'
   and internal.next_age_grade_for('U17','boys','union') = 'U18' then
  raise notice 'PASS 1 (A): union male progresses U15 -> U16 -> U17 -> U18';
else
  raise notice 'FAIL 1 (A): union male later-youth progression is wrong';
end if;

if internal.next_age_grade_for('U18','boys','union') is null then
  raise notice 'PASS 2 (A): union U18 has NO automatic successor -- senior entry is a decision, not a roll';
else
  raise notice 'FAIL 2 (A): union U18 auto-progresses to %', internal.next_age_grade_for('U18','boys','union');
end if;

-- It must never fall into the League pathway.
if internal.next_age_grade_for('U18','boys','union') is distinct from 'U19' then
  raise notice 'PASS 3 (A): union U18 never enters the League U19 pathway';
else
  raise notice 'FAIL 3 (A): union U18 rolled into League U19';
end if;

-- ============ B. Union girls: dual age bands ============

if internal.next_age_grade_for('U12','girls','union') = 'U14'
   and internal.next_age_grade_for('U14','girls','union') = 'U16'
   and internal.next_age_grade_for('U16','girls','union') = 'U18' then
  raise notice 'PASS 4 (B): union girls step band to band U12 -> U14 -> U16 -> U18';
else
  raise notice 'FAIL 4 (B): union girls band progression is wrong';
end if;

if internal.next_age_grade_for('U18','girls','union') is null then
  raise notice 'PASS 5 (B): union girls U18 has no automatic successor';
else
  raise notice 'FAIL 5 (B): union girls U18 auto-progresses';
end if;

-- No union girls single-year identity may be manufactured.
select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code='union' and gender='girls' and age_group in ('U13','U15','U17') and is_offered;
if v_count = 0 then
  raise notice 'PASS 6 (B): union offers no Girls U13/U15/U17 identity';
else
  raise notice 'FAIL 6 (B): union offers % girls single-year identity/identities', v_count;
end if;

-- ============ C. League male: one grade further ============

if internal.next_age_grade_for('U16','boys','league') = 'U17'
   and internal.next_age_grade_for('U17','boys','league') = 'U18'
   and internal.next_age_grade_for('U18','boys','league') = 'U19' then
  raise notice 'PASS 7 (C): league male progresses U16 -> U17 -> U18 -> U19';
else
  raise notice 'FAIL 7 (C): league male later-youth progression is wrong';
end if;

if internal.next_age_grade_for('U19','boys','league') is null then
  raise notice 'PASS 8 (C): league U19 has no automatic successor -- Open Age eligibility is not auto-assignment';
else
  raise notice 'FAIL 8 (C): league U19 auto-progresses to %', internal.next_age_grade_for('U19','boys','league');
end if;

-- ============ D. League girls: the 2026 U17 withdrawal ============

if internal.next_age_grade_for('U12','girls','league') = 'U13'
   and internal.next_age_grade_for('U13','girls','league') = 'U14'
   and internal.next_age_grade_for('U14','girls','league') = 'U15'
   and internal.next_age_grade_for('U15','girls','league') = 'U16' then
  raise notice 'PASS 9 (D): league girls progress single-year U12 -> U13 -> U14 -> U15 -> U16';
else
  raise notice 'FAIL 9 (D): league girls single-year progression is wrong';
end if;

-- The heart of it: no successor, because the 2026 Girls League has no U17.
if internal.next_age_grade_for('U16','girls','league') is null then
  raise notice 'PASS 10 (D): league girls U16 has NO automatic successor -- routes to NEEDS_ATTENTION';
else
  raise notice 'FAIL 10 (D): league girls U16 auto-progresses to %', internal.next_age_grade_for('U16','girls','league');
end if;

-- It must not have silently borrowed the MALE league pathway.
if internal.next_age_grade_for('U16','girls','league') is distinct from 'U17' then
  raise notice 'PASS 11 (D): league girls did not inherit the male U16 -> U17 step';
else
  raise notice 'FAIL 11 (D): league girls inherited the male pathway -- Girls U17 was inferred';
end if;

-- Nor jumped straight to U18 without evidence.
if internal.next_age_grade_for('U16','girls','league') is distinct from 'U18' then
  raise notice 'PASS 12 (D): league girls U16 does not silently jump to U18';
else
  raise notice 'FAIL 12 (D): league girls U16 jumped to U18 without established evidence';
end if;

-- And no Girls U17 operational identity exists in either code.
if not exists (select 1 from public.canonical_team_types where gender='girls' and age_group='U17') then
  raise notice 'PASS 13 (D): no Girls U17 canonical identity exists at all';
else
  raise notice 'FAIL 13 (D): a Girls U17 canonical identity was created';
end if;

-- ============ E. ONE progression source: the projector must agree ============

select projected_age_group, is_deterministic into v_text, v_det
from internal.project_team_identity('U12','girls','union',1);
if v_text = 'U14' then
  raise notice 'PASS 14 (E): the future-season projector steps union girls by band, like the rollover';
else
  raise notice 'FAIL 14 (E): projector says U12 girls union -> %', coalesce(v_text,'(null)');
end if;

select projected_age_group into v_text from internal.project_team_identity('U18','boys','league',1);
if v_text = 'U19' then
  raise notice 'PASS 15 (E): the projector carries league boys U18 -> U19';
else
  raise notice 'FAIL 15 (E): projector says U18 boys league -> %', coalesce(v_text,'(null)');
end if;

select is_deterministic into v_det from internal.project_team_identity('U16','girls','league',1);
if not v_det then
  raise notice 'PASS 16 (E): the projector reports league girls U16 as NOT deterministic';
else
  raise notice 'FAIL 16 (E): projector claims a deterministic successor for league girls U16';
end if;

select is_deterministic into v_det from internal.project_team_identity('U18','boys','union',1);
if not v_det then
  raise notice 'PASS 17 (E): the projector reports union U18 as NOT deterministic';
else
  raise notice 'FAIL 17 (E): projector claims a deterministic successor for union U18';
end if;

-- A mixed U11 cohort splits at U12; that is a decision either way.
select is_deterministic into v_det from internal.project_team_identity('U11','mixed','union',1);
if not v_det then
  raise notice 'PASS 18 (E): a mixed U11 cohort is NOT projected forward -- the U12 split is a decision';
else
  raise notice 'FAIL 18 (E): a mixed U11 cohort was projected forward';
end if;

-- ============ F. No dead Colts assumptions remain in handover ============

-- Strip SQL line comments before matching. Several of these functions
-- explain in prose WHY the Colts gate was removed, and a naive grep over the
-- whole definition flags that explanation as if it were live logic. The
-- assertion is about executable code, so the test must look at executable
-- code.
select count(*) into v_count
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','internal') and p.prokind = 'f'
  and p.proname in ('graduate_team','generate_rollover_proposal','generate_rollover_proposal_core','project_team_identity')
  and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* '(JuniorColts|SeniorColts)';
if v_count = 0 then
  raise notice 'PASS 19 (F): no handover function still keys off JuniorColts/SeniorColts';
else
  raise notice 'FAIL 19 (F): % handover function(s) still reference Colts age groups', v_count;
end if;

-- The automatic transition path must use the code-aware successor.
if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='internal' and p.proname='generate_rollover_proposal_core') ~ 'next_age_grade_for' then
  raise notice 'PASS 20 (F): the AUTOMATIC transition generator uses the code-aware successor';
else
  raise notice 'FAIL 20 (F): the automatic transition generator still uses the code-blind successor';
end if;

-- The real invariant is that the manual and automatic paths cannot disagree
-- about the successor, and there are exactly two ways to guarantee that: the
-- manual path calls the same code-aware successor, or it has no successor
-- logic of its own and delegates to the automatic one. This assertion used to
-- test only the first form by grepping for next_age_grade_for; when the
-- wrapper was changed to delegate -- a STRONGER guarantee, since there is then
-- only one implementation to keep correct -- the old form went red for the
-- right behaviour. It is re-pointed at the invariant, not relaxed: delegation
-- only passes if the wrapper carries no successor call of its own.
select pg_get_functiondef(p.oid) into v_def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'generate_rollover_proposal';

if v_def ~ 'generate_rollover_proposal_core' and v_def !~ 'next_age_grade' then
  raise notice 'PASS 21 (F): the manual generator DELEGATES -- one implementation of the progression step, so the two paths cannot diverge';
elsif v_def ~ 'next_age_grade_for' and v_def !~ 'next_age_grade\(' then
  raise notice 'PASS 21 (F): the manual generator uses the same code-aware successor as the automatic one';
else
  raise notice 'FAIL 21 (F): the manual generator has successor logic that can diverge from the automatic one';
end if;

-- And the progression step must exist in exactly one place. Two copies is how
-- the code-blind successor survived in the automatic path after the manual
-- path was already fixed.
select count(*) into v_count
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','internal') and p.prokind = 'f'
  and p.proname in ('generate_rollover_proposal','generate_rollover_proposal_core')
  and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ 'next_age_grade_for';
if v_count = 1 then
  raise notice 'PASS 21b (F): the handover progression step is implemented ONCE, not copied between the two paths';
else
  raise notice 'FAIL 21b (F): % handover generators carry their own copy of the progression step', v_count;
end if;

-- ============ G. Senior identities persist; they do not age up ============

if internal.next_age_grade_for(null, 'mens', 'league') is null
   and internal.next_age_grade_for(null, 'mens', 'union') is null then
  raise notice 'PASS 22 (G): senior identities have no age successor -- Open Age and numbered XVs persist';
else
  raise notice 'FAIL 22 (G): a senior identity was given an age successor';
end if;

-- ============ H. Handover Register stores stable IDs, projects labels ============

-- Authority columns exist and are canonical references, not text.
select count(*) into v_count
from information_schema.columns
where table_schema='public' and table_name='age_grade_rollover_team_proposals'
  and column_name in ('from_canonical_team_type_id','proposed_to_canonical_team_type_id','decided_canonical_team_type_id')
  and data_type='uuid';
if v_count = 3 then
  raise notice 'PASS 23 (H): the register carries canonical team type IDs, not just age-group text';
else
  raise notice 'FAIL 23 (H): only % of the 3 canonical ID columns exist as uuid', v_count;
end if;

-- No display label is stored anywhere in the register.
if not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='age_grade_rollover_team_proposals'
    and column_name in ('display_name','label','team_name')
) then
  raise notice 'PASS 24 (H): the register stores NO display label -- labels are projections';
else
  raise notice 'FAIL 24 (H): the register stores a display label';
end if;

-- The view joins labels live, so a rename propagates without touching rows.
if (select count(*) from pg_views where schemaname='public' and viewname='handover_register') = 1
   and (select definition from pg_views where schemaname='public' and viewname='handover_register') ~ 'canonical_team_types' then
  raise notice 'PASS 25 (H): handover_register projects its labels live from the canonical directory';
else
  raise notice 'FAIL 25 (H): handover_register does not join the canonical directory for labels';
end if;

-- NEEDS_ATTENTION must be reachable and must carry a reason.
if (select definition from pg_views where schemaname='public' and viewname='handover_register') ~ 'NEEDS_ATTENTION' then
  raise notice 'PASS 26 (H): the register exposes a NEEDS_ATTENTION state rather than forcing READY';
else
  raise notice 'FAIL 26 (H): the register has no NEEDS_ATTENTION state';
end if;

-- ============ I. Movement resolver shares the one progression graph ============

-- Executable logic must not key off Colts any more.
if not (regexp_replace(
     (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='resolve_player_movement_eligibility'),
     '--[^\n]*', '', 'g') ~* '(JuniorColts|SeniorColts)') then
  raise notice 'PASS 27 (I): the movement resolver no longer keys off Colts age groups';
else
  raise notice 'FAIL 27 (I): the movement resolver still contains live Colts logic';
end if;

-- And it must consult the SAME successor the rollover uses.
if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='internal' and p.proname='resolve_player_movement_eligibility') ~ 'next_age_grade_for' then
  raise notice 'PASS 28 (I): the movement resolver uses the canonical code-aware successor';
else
  raise notice 'FAIL 28 (I): the movement resolver uses a separate progression rule';
end if;

-- The live defect this fixed: a union girls band move must read as ordinary.
select requirement into v_text
from internal.resolve_player_movement_eligibility('union', current_date, date '2014-01-01', null::uuid, null::uuid);
if v_text = 'not_permitted' then
  raise notice 'PASS 29 (I): the resolver refuses unknown teams rather than guessing';
else
  raise notice 'FAIL 29 (I): unknown teams returned %', v_text;
end if;

end $$;


rollback;

\echo '=== Done. Every assertion above should read PASS. ==='

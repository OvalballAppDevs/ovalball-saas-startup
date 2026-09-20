-- =====================================================================
-- ONE SPELLING FOR ONE ROLE — L3, closed where it lives.
--
-- The product calls this role "Fixture Secretary". `lib/permissions/role-labels.ts`
-- says so, and its own comment records the decision: the label was reconciled
-- across four files in Convergence Step 2 because it had been read as
-- "Fixture Secretary" in two and "Fixtures Admin" in two others.
--
-- `public.role_definitions` was never part of that reconciliation. It has said
-- "Fixtures Secretary" since Slice 2, and it is the row every server-side
-- refusal quotes -- `assign_role` raises "You are not authorised to give the %
-- role at this club" with `v_role.label` in it. So a club administrator could
-- be refused in one spelling and offered the same role in another, which is
-- exactly the failure the content standard exists to prevent.
--
-- The programme ledger carries this as L3: "the catalogue key/label
-- inconsistency stays open for its schema owner." Slice 8 is the slice that
-- owns the club role catalogue's presentation, so this is where it closes.
--
-- THE KEY DOES NOT CHANGE. `FIXTURES_SECRETARY` is an identifier: it is
-- referenced by role_assignments rows, by assignable_by arrays, and by the
-- mapping in internal.apply_primary_club_role. CLAUDE.md is explicit that
-- technical identifiers are not rewritten for prose reasons. Only the human
-- label moves, which is the only thing anybody reads.
-- =====================================================================

update public.role_definitions
   set label = 'Fixture Secretary'
 where role_key = 'FIXTURES_SECRETARY'
   and label <> 'Fixture Secretary';

-- The capability bundle catalogue says it too, and its label is what an
-- Effective Access explanation quotes when it names where an answer came from.
-- Correcting one catalogue and not the other would leave the same two spellings
-- in the same conversation.
update public.capability_bundles
   set label = 'Fixture Secretary'
 where bundle_key = 'FS'
   and label <> 'Fixture Secretary';

do $guard$
declare
  v_label text;
  v_plural int;
begin
  select label into v_label from public.role_definitions where role_key = 'FIXTURES_SECRETARY';
  if v_label is distinct from 'Fixture Secretary' then
    raise exception 'The role catalogue still calls it %.', coalesce(v_label, '(missing)');
  end if;

  -- And no catalogue a person reads may drift into the plural either.
  select (select count(*) from public.role_definitions where label like '%Fixtures%')
       + (select count(*) from public.capability_bundles where label like '%Fixtures%')
    into v_plural;
  if v_plural > 0 then
    raise exception '% catalogue label(s) still say "Fixtures" where the product says "Fixture".', v_plural;
  end if;

  -- The key is untouched, and everything that points at it still resolves.
  if not exists (select 1 from public.role_definitions where role_key = 'FIXTURES_SECRETARY') then
    raise exception 'The FIXTURES_SECRETARY key was changed. It is an identifier, not prose.';
  end if;
end;
$guard$;

-- Fix: the initial pitch_allocation_proposals/_items migration wrote a
-- comment claiming writes went through a SECURITY DEFINER RPC, but no
-- such RPC was actually built -- the server action inserts directly via
-- the RLS-bound client, which correctly failed closed (RLS policy
-- violation) rather than silently succeeding, caught by live browser
-- testing immediately after deploying the UI. Adding the real INSERT/
-- UPDATE/DELETE policies here, gated by the exact same capability the
-- server action itself already checks before ever reaching these tables
-- (requirePitchAllocationAccess() in actions.ts) -- the RLS policy is
-- defense in depth, not the only check.
create policy pitch_allocation_proposals_insert on public.pitch_allocation_proposals for insert
  with check (internal.has_capability('fixture.edit', 'club', club_id, null) or internal.is_site_admin());
create policy pitch_allocation_proposals_update on public.pitch_allocation_proposals for update
  using (internal.has_capability('fixture.edit', 'club', club_id, null) or internal.is_site_admin())
  with check (internal.has_capability('fixture.edit', 'club', club_id, null) or internal.is_site_admin());

create policy pitch_allocation_proposal_items_insert on public.pitch_allocation_proposal_items for insert
  with check (exists (
    select 1 from public.pitch_allocation_proposals p
    where p.id = proposal_id and (internal.has_capability('fixture.edit', 'club', p.club_id, null) or internal.is_site_admin())
  ));
create policy pitch_allocation_proposal_items_delete on public.pitch_allocation_proposal_items for delete
  using (exists (
    select 1 from public.pitch_allocation_proposals p
    where p.id = proposal_id and (internal.has_capability('fixture.edit', 'club', p.club_id, null) or internal.is_site_admin())
  ));

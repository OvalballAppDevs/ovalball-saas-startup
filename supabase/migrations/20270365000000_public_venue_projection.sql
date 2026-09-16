-- Slice 4E -- part 2 of 3: the public venue projection (Phase 2 AA.3 row 4e, design J.9 line 499).
--
-- ADDITIVE, and separated from the contract migration for a measured reason. The compatibility
-- matrix showed that neither pure release order is safe for this slice:
--
--   application first, migrations second  -> the new /competitions/[slug] reads public.public_venues,
--                                            which would not exist yet
--   migrations first, application second  -> retiring the calendar adapter makes the OLD build's
--                                            hasCapability('calendar.manage') read FALSE, so a Club
--                                            Admin loses the club-events controls until it deploys
--
-- So the slice releases in three stages, and this is the one that has to land BEFORE the deployment:
-- it only adds an object, and the build then serving neither knows nor needs it.

-- The public projection J.9 line 499 names: explicit public fields only. Anonymous visitors read a
-- venue's NAME because a public competition fixture has to say where it is played; they read
-- nothing else. Previously anon held column-level SELECT on the venues table itself, which is the
-- same shape of grant that misled me in Slice 4D -- a table-level privilege test reports FALSE for
-- it, so the exposure is easy to miss. A view makes the public surface explicit and reviewable.
-- drop-then-create rather than `create or replace`: replacing a view cannot change its column
-- list, so a future edit that adds or removes a public field would fail to apply rather than apply
-- wrongly. This is also what makes the migration re-runnable.
drop view if exists public.public_venues;
create view public.public_venues
with (security_invoker = false) as
  select v.id, v.name, v.club_id
  from public.venues v
  where v.active;

comment on view public.public_venues is
  'Slice 4E: the only anonymous projection of a venue -- id, name and owning club, nothing else. '
  'Definer-rights on purpose: it exists so that anon never needs a grant on public.venues.';

revoke all on public.public_venues from public, anon, authenticated;
grant select on public.public_venues to anon, authenticated;
revoke all on public.venues from anon;

do $$
begin
  if exists (select 1 from information_schema.column_privileges
             where table_schema='public' and table_name='venues' and grantee='anon') then
    raise exception 'anon still holds a column grant on public.venues; the M-2 residue is not closed.';
  end if;
  if not has_table_privilege('anon', 'public.public_venues', 'SELECT') then
    raise exception 'anon cannot read public.public_venues; the public competition surface would lose venue names.';
  end if;
end $$;

-- =====================================================================================================
-- A COMPATIBILITY VIEW MUST NOT BE A WAY ROUND ROW-LEVEL SECURITY.
--
-- 20270605 retired `tournament_team_entries` from a table to a view over `tournament_participants`, so
-- that the handful of remaining readers kept working while the one canonical table of sides took over.
-- The view was created without `security_invoker`, which in PostgreSQL means OWNER-RIGHTS: it runs as
-- the view's owner, and the owner is not subject to the base table's policies.
--
-- THE EFFECT, MEASURED. A signed-in person with no connection to any tournament reads
--
--   2 rows from public.tournament_participants   (correct -- what the SELECT policy allows them)
--   10 rows from public.tournament_team_entries  (every host side on the platform)
--
-- for the same session, in the same transaction. The policy was not weakened; it was simply never
-- consulted, because nothing asks a table's policies when an owner-rights view reads it. Both
-- relations are granted to `authenticated`, so this was reachable straight from a browser -- it did
-- not need a function, an RPC or a mistake at a call site.
--
-- A SHIM IS THE EASIEST PLACE FOR THIS TO HAPPEN AND THE HARDEST PLACE TO NOTICE IT. The view was
-- added to avoid changing readers, which is exactly why nobody looked at it as a new perimeter: it
-- was meant to be the thing that changed nothing.
--
-- `security_invoker = true` makes the view read with the CALLER'S rights, so
-- `tournament_participants_select_scoped` -- and therefore `internal.tournament_visible_row` -- decides
-- every row, which is what the table itself already did.
--
-- THE DEFINER READERS ARE UNAFFECTED. `get_tournament_centre`, `internal.can_manage_tournament`,
-- `internal.can_manage_tournament_entry`, `count_tournament_age_group_impact`,
-- `record_tournament_opponent` and `internal.validate_tournament_entry_opponent` are all SECURITY
-- DEFINER and run as the owner, who is exempt from the policies in the ordinary way. They each do
-- their own authority check, and none of them relied on the view to do it.
-- =====================================================================================================

alter view public.tournament_team_entries set (security_invoker = true);

comment on view public.tournament_team_entries is
  'Compatibility projection of tournament_participants for the host club''s own sides, kept while the '
  'last readers move across. SECURITY INVOKER deliberately: a view over a table with row-level '
  'security must read with the caller''s rights, or it becomes a way round the policy it is standing '
  'in front of.';

-- A permanent assertion. An owner-rights view is the default in PostgreSQL, so a future
-- `create or replace view` that forgets the option silently reopens this.
do $$
declare v_mode text;
begin
  select coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false')
    into v_mode
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'tournament_team_entries';

  if v_mode is distinct from 'true' then
    raise exception 'tournament_team_entries is owner-rights, so it reads past tournament_participants'' policies.';
  end if;
end $$;

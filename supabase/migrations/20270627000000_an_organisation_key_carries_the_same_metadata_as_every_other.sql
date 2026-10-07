-- =====================================================================================================
-- AN ORGANISATION KEY CARRIES THE SAME METADATA AS EVERY OTHER.
--
-- Convergence Step 16 registered `governing.access.manage` -- the name of the authority to invite and
-- remove somebody at a governing body -- with a full rationale and a guard, but without three of the
-- columns every other active key carries: `server_enforcement`, `legacy_key` and `migration_action`.
--
-- The catalogue suites caught it, and they were right to: those three are how a reader of the
-- catalogue answers "what enforces this, what was it called before, and what happened to it". A key
-- that answers none of them is a key nobody can audit.
--
-- WHAT THE VALUES ARE, and they are facts rather than placeholders:
--
--   server_enforcement  `internal.can_manage_body` -- this authority is resolved over
--                       `constituent_body_roles` and NEVER through `internal.capability_decision`,
--                       because the `organisation` scope is reserved there and deliberately not
--                       implemented. Saying so in the catalogue is the point of the column.
--   legacy_key          itself. It is new at Step 16 and had no predecessor, which is what every other
--                       key with no legacy ancestor records.
--   migration_action    KEEP. It is canonical; nothing resolves to it and it resolves to nothing.
--
-- NOTHING ABOUT AUTHORITY CHANGES. No scope, no grant level, no status -- three descriptive columns
-- are filled in on one row.
-- =====================================================================================================

update public.capabilities
set server_enforcement = 'internal.can_manage_body (organisation scope; never internal.can)',
    legacy_key = 'governing.access.manage',
    migration_action = 'KEEP'
where key = 'governing.access.manage'
  and (server_enforcement is null or legacy_key is null or migration_action is null);

do $$
declare v_list text;
begin
  select string_agg(key, ', ') into v_list from public.capabilities
  where status = 'ACTIVE'
    and (domain is null or resource is null or action is null or grant_level is null or revoke_level is null
      or aal is null or server_enforcement is null or legacy_key is null or migration_action is null
      or label is null or description is null);
  if v_list is not null then
    raise exception 'active capability key(s) still missing metadata: %', v_list;
  end if;
end $$;

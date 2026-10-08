-- Applied to the EMPTY restore target BEFORE the dumped schema.
--
-- pg_dump writes default privileges at the END of the schema, so every table, sequence and function it creates
-- first inherits the fresh project's platform defaults -- ALL to anon, authenticated AND service_role. pg_dump then
-- only ADDS the grants each object has; it never revokes one the source simply did not have. So:
--   * without this file, anon and authenticated get every privilege on every public table and function
--     (rehearsal: 335 extra table grants, 850 changed function ACLs);
--   * with only anon/authenticated revoked, service_role keeps ALL where Ovalball deliberately limited it --
--     e.g. public.audit_log, which service_role may only read (rehearsal: found by the extended fingerprint).
-- Revoking all three makes every object start owner-only, so the dump's own GRANTs reproduce the source exactly;
-- the dump's closing ALTER DEFAULT PRIVILEGES then restores the source's defaults for future objects.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;

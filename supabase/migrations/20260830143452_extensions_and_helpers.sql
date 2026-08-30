-- Extensions and shared helper functions used by later migrations.
--
-- No native Postgres enum types are created in this migration set (deliberate
-- deviation from the "enums / shared lookup types" example category): every
-- constrained-value column below uses `text` + `check (... in (...))` instead.
-- A check constraint can be widened later with a plain
-- `alter table ... drop constraint ... / add constraint ...` migration;
-- extending a native enum requires `alter type ... add value`, which is more
-- restrictive (cannot run inside the same transaction as other DDL on some
-- Postgres versions) for no benefit at this schema's scale.

create extension if not exists pgcrypto with schema extensions;

-- Shared BEFORE UPDATE trigger: stamps updated_at = now() on every row
-- update. Attached per-table in the final RLS/triggers migration, not here,
-- so each table-creation migration stays pure structure with no behaviour.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Stamps updated_at = now() on row update. Attached per-table in 20260830143512_rls_policies_and_triggers.sql.';

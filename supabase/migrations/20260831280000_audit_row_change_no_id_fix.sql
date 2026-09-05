-- Fixes a real, previously-undetected bug found by Phase 3's live proof:
-- internal.audit_row_change() (moved from public in 20260830155339) hardcodes
-- new.id/old.id, which raises `record "new" has no field "id"` on the one
-- audited table that has no single `id` column --
-- public.permission_group_capabilities, whose primary key is the composite
-- (group_id, capability_key). This silently broke every attempt to save a
-- permission group's capability list (create OR edit) the first time it was
-- exercised through the real authenticated path with the trigger active --
-- the group row itself saved fine (its own audit_row_change trigger has a
-- real id), but the capability-list insert always failed and rolled back,
-- while the UI showed only the generic "Your request could not be
-- submitted" message with no indication of the real cause.
--
-- Fix: extract the id defensively via to_jsonb(...)->>'id' (present for all
-- 28 other audited tables, so their behavior is byte-for-byte unchanged)
-- and fall back to null when a table has no id column at all, rather than
-- raising. audit_log.record_id is relaxed to nullable to allow that one
-- fallback case; the full row is still captured in before/after jsonb
-- regardless, so no audit information is lost -- only the denormalized
-- record_id lookup column is absent for this one composite-key table.

alter table public.audit_log alter column record_id drop not null;

create or replace function internal.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, record_id, action, changed_by, after)
    values (tg_table_name, nullif(to_jsonb(new)->>'id', '')::uuid, 'insert', v_actor, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values (tg_table_name, nullif(to_jsonb(new)->>'id', '')::uuid, 'update', v_actor, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, before)
    values (tg_table_name, nullif(to_jsonb(old)->>'id', '')::uuid, 'delete', v_actor, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

comment on function internal.audit_row_change() is
  'Generic AFTER INSERT/UPDATE/DELETE trigger function. record_id is extracted defensively (nullable) so a table with no single-column id (e.g. permission_group_capabilities, a composite-key junction table) still gets a full before/after audit row instead of the trigger raising.';

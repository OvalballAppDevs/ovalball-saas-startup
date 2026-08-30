-- Generic audit trail. This migration creates the table and the trigger
-- function only; the function is attached to each admin-managed table's
-- INSERT/UPDATE/DELETE in the final migration.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete', 'deactivate')),
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  before jsonb,
  after jsonb
);

comment on table public.audit_log is
  'Practical audit trail (who/what/when/before-after), not full event sourcing. Populated automatically by triggers, never by application code directly.';

create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_changed_at_idx on public.audit_log (changed_at desc);

create function public.audit_row_change()
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
    values (tg_table_name, new.id, 'insert', v_actor, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values (tg_table_name, new.id, 'update', v_actor, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, before)
    values (tg_table_name, old.id, 'delete', v_actor, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_row_change() is
  'Generic AFTER INSERT/UPDATE/DELETE trigger function. Attached per-table in 20260830143512_rls_policies_and_triggers.sql.';

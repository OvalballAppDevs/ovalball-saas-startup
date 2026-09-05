-- Rugby Union and Rugby League are separate canonical sporting identities,
-- not a club attribute a Site Admin should be able to flip through an
-- ordinary edit form. RLS alone can't express "this column, not that one"
-- -- club_directory_update_admin already correctly gates the whole row to
-- any Site Admin, and column-level privileges don't compose with RLS the
-- way this needs. A row-level trigger does: it rejects any UPDATE that
-- changes rugby_code unless a transaction-local flag is set, and the ONLY
-- place that ever sets that flag is correct_club_rugby_code() below --
-- every ordinary UPDATE from Club Management's edit forms (which never
-- sets it) is rejected outright, at the database, regardless of what the
-- client sends.
create or replace function internal.prevent_casual_rugby_code_change()
returns trigger
language plpgsql
as $$
begin
  if new.rugby_code is distinct from old.rugby_code then
    if coalesce(current_setting('app.rugby_code_correction', true), '') <> 'true' then
      raise exception 'rugby_code cannot be changed through an ordinary update -- use the Rugby Code correction workflow.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_casual_rugby_code_change
before update on public.club_directory
for each row execute function internal.prevent_casual_rugby_code_change();

-- Every genuine correction is logged here, separately from the generic
-- audit_row_change trigger (which captures the row's before/after state
-- but has no place for a human-readable reason) -- this is the direct,
-- purpose-built history for "why did this club's code change."
create table public.club_directory_rugby_code_corrections (
  id uuid primary key default gen_random_uuid(),
  directory_id uuid not null references public.club_directory(id) on delete cascade,
  from_code text not null,
  to_code text not null,
  reason text not null,
  corrected_by uuid not null references auth.users(id),
  corrected_at timestamptz not null default now()
);

alter table public.club_directory_rugby_code_corrections enable row level security;

create policy club_directory_rugby_code_corrections_select on public.club_directory_rugby_code_corrections
  for select using (internal.is_site_admin());

comment on table public.club_directory_rugby_code_corrections is 'Audit trail for correct_club_rugby_code() -- the only path that can ever change club_directory.rugby_code, enforced by the prevent_casual_rugby_code_change trigger.';

-- The privileged correction itself. Full Site Admin only (a data-integrity
-- action with wide blast radius -- every fixture, team, and search result
-- for this club implicitly assumes its rugby code), requires a real reason,
-- and never silently merges two directory rows -- callers correct ONE
-- club's code, they don't get a "merge with the League version" shortcut
-- here, matching the brief's "never merge similarly named Union and League
-- clubs merely because names/locations match."
create or replace function public.correct_club_rugby_code(p_directory_id uuid, p_new_code text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_code text;
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin can correct a club''s rugby code.' using errcode = '42501';
  end if;
  if p_new_code not in ('union', 'league') then
    raise exception 'Invalid rugby code.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for a rugby code correction.';
  end if;

  select rugby_code into v_old_code from public.club_directory where id = p_directory_id for update;
  if not found then
    raise exception 'Club not found.';
  end if;
  if v_old_code = p_new_code then
    raise exception 'This club is already marked as %.', p_new_code;
  end if;

  perform set_config('app.rugby_code_correction', 'true', true);
  update public.club_directory set rugby_code = p_new_code, updated_by = auth.uid() where id = p_directory_id;
  perform set_config('app.rugby_code_correction', 'false', true);

  insert into public.club_directory_rugby_code_corrections (directory_id, from_code, to_code, reason, corrected_by)
  values (p_directory_id, v_old_code, p_new_code, trim(p_reason), auth.uid());
end;
$$;

-- Authorization helpers, cross-table integrity triggers, updated_at/audit
-- trigger attachment, and Row Level Security for every table created by
-- this migration set. This is the only migration containing any
-- authorization logic — every earlier migration is pure structure.

-- ============================================================
-- 1. Authorization helper functions
-- ============================================================

create function public.is_site_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.site_admins sa
    where sa.user_id = auth.uid() and sa.status = 'active'
  );
$$;

comment on function public.is_site_admin() is
  'True if the current session belongs to an active Site Admin. Never inferred from club membership.';

create function public.is_club_admin(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.club_memberships cm
    where cm.club_id = p_club_id
      and cm.user_id = auth.uid()
      and cm.role = 'CLUB_ADMIN'
      and cm.status = 'active'
  );
$$;

comment on function public.is_club_admin(uuid) is
  'True if the current session is a verified CLUB_ADMIN of the given club.';

create function public.can_manage_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.is_site_admin()
    or public.is_club_admin((select club_id from public.teams where id = p_team_id))
    or exists (
      select 1
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and tp.permission = 'manage'
    );
$$;

comment on function public.can_manage_team(uuid) is
  'True for Site Admins, the team''s club admin, or a user explicitly granted manage permission on that specific team.';

-- ============================================================
-- 2. Cross-table rugby_code integrity (the enforcement half of the
--    three-level rugby_code strategy: club_directory -> teams ->
--    competition_editions -> competition_edition_teams)
-- ============================================================

create function public.enforce_team_rugby_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_directory_code text;
begin
  select cd.rugby_code into v_directory_code
  from public.clubs c
  join public.club_directory cd on cd.id = c.directory_id
  where c.id = new.club_id;

  if v_directory_code is not null and v_directory_code <> new.rugby_code then
    raise exception 'teams.rugby_code (%) does not match the club''s club_directory.rugby_code (%)', new.rugby_code, v_directory_code;
  end if;
  return new;
end;
$$;

create trigger teams_enforce_rugby_code
before insert or update of rugby_code, club_id on public.teams
for each row execute function public.enforce_team_rugby_code();

create function public.enforce_competition_edition_rugby_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code text;
begin
  select rugby_code into v_code from public.competitions where id = new.competition_id;
  if v_code is not null and v_code <> new.rugby_code then
    raise exception 'competition_editions.rugby_code (%) does not match competitions.rugby_code (%)', new.rugby_code, v_code;
  end if;
  return new;
end;
$$;

create trigger competition_editions_enforce_rugby_code
before insert or update of rugby_code, competition_id on public.competition_editions
for each row execute function public.enforce_competition_edition_rugby_code();

create function public.enforce_edition_team_rugby_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_edition_code text;
  v_team_code text;
begin
  select rugby_code into v_edition_code from public.competition_editions where id = new.competition_edition_id;
  select rugby_code into v_team_code from public.teams where id = new.team_id;
  if v_edition_code is distinct from v_team_code then
    raise exception 'team rugby_code (%) does not match competition edition rugby_code (%)', v_team_code, v_edition_code;
  end if;
  return new;
end;
$$;

create trigger competition_edition_teams_enforce_rugby_code
before insert or update on public.competition_edition_teams
for each row execute function public.enforce_edition_team_rugby_code();

comment on function public.enforce_edition_team_rugby_code() is
  'The actual join-point guard preventing a Union team from being entered into a League competition edition, or vice versa.';

-- ============================================================
-- 3. updated_at triggers (only tables that have an updated_at column)
-- ============================================================

create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.site_admins for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.club_directory for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.clubs for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.club_claims for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.club_join_requests for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.directory_requests for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.team_contacts for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.club_memberships for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.club_contacts for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.club_opponent_notes for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.venues for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.competitions for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.seasons for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.competition_editions for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.fixtures for each row execute function public.set_updated_at();

-- ============================================================
-- 4. Audit triggers (every admin-managed table; excludes terms_acceptances
--    and audit_log itself, which are already self-evidently their own log)
-- ============================================================

create trigger audit_row_change after insert or update or delete on public.profiles for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.site_admins for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_directory for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_aliases for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.clubs for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_claims for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_join_requests for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.directory_requests for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.teams for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.team_contacts for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_memberships for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.team_permissions for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_contacts for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_opponent_notes for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.venues for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.competitions for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.seasons for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.competition_editions for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.competition_edition_teams for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.fixtures for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.fixture_source_refs for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.unresolved_names for each row execute function public.audit_row_change();

-- ============================================================
-- 5. Row Level Security
-- ============================================================

alter table public.profiles enable row level security;
alter table public.site_admins enable row level security;
alter table public.club_directory enable row level security;
alter table public.club_aliases enable row level security;
alter table public.clubs enable row level security;
alter table public.club_claims enable row level security;
alter table public.club_join_requests enable row level security;
alter table public.directory_requests enable row level security;
alter table public.teams enable row level security;
alter table public.team_contacts enable row level security;
alter table public.club_memberships enable row level security;
alter table public.team_permissions enable row level security;
alter table public.club_contacts enable row level security;
alter table public.club_opponent_notes enable row level security;
alter table public.venues enable row level security;
alter table public.competitions enable row level security;
alter table public.seasons enable row level security;
alter table public.competition_editions enable row level security;
alter table public.competition_edition_teams enable row level security;
alter table public.fixtures enable row level security;
alter table public.fixture_source_refs enable row level security;
alter table public.unresolved_names enable row level security;
alter table public.terms_acceptances enable row level security;
alter table public.audit_log enable row level security;

-- profiles: a user manages their own; Site Admin can read/update for support.
create policy profiles_select_self_or_admin on public.profiles for select
  using (id = auth.uid() or public.is_site_admin());
create policy profiles_insert_self on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update_self_or_admin on public.profiles for update
  using (id = auth.uid() or public.is_site_admin());

-- site_admins: only existing Site Admins can see or manage the admin roster.
create policy site_admins_all_site_admin on public.site_admins for all
  using (public.is_site_admin()) with check (public.is_site_admin());

-- club_directory: public reads active rows; Site Admin has full read/write.
-- No delete policy anywhere — deactivate via `active`, never delete.
create policy club_directory_select_active on public.club_directory for select
  to anon, authenticated using (active = true);
create policy club_directory_select_admin on public.club_directory for select
  using (public.is_site_admin());
create policy club_directory_write_admin on public.club_directory for insert
  with check (public.is_site_admin());
create policy club_directory_update_admin on public.club_directory for update
  using (public.is_site_admin());

-- club_aliases: public reads (needed for signup club search); Site Admin
-- writes.
create policy club_aliases_select_all on public.club_aliases for select
  to anon, authenticated using (true);
create policy club_aliases_write_admin on public.club_aliases for insert
  with check (public.is_site_admin());
create policy club_aliases_update_admin on public.club_aliases for update
  using (public.is_site_admin());
create policy club_aliases_delete_admin on public.club_aliases for delete
  using (public.is_site_admin());

-- clubs: public reads active clubs; Site Admin/club admin read all and
-- update the profile. Deliberately NO insert policy — per the approved
-- matrix, a clubs row is only ever meant to be created as part of an
-- atomic claim/directory-request approval, which is future business-logic
-- (not built this round). Until that function exists, clubs rows can only
-- be created via direct SQL/service-role, never through the app API.
create policy clubs_select_active on public.clubs for select
  to anon, authenticated using (status = 'active');
create policy clubs_select_admin on public.clubs for select
  using (public.is_site_admin() or public.is_club_admin(id));
create policy clubs_update_admin on public.clubs for update
  using (public.is_site_admin() or public.is_club_admin(id));

-- club_claims: a user can submit their own claim; only Site Admin reads or
-- decides (matches the approved admin matrix exactly).
create policy club_claims_insert_self on public.club_claims for insert
  to authenticated with check (claimant_user_id = auth.uid());
create policy club_claims_select_admin on public.club_claims for select
  using (public.is_site_admin());
create policy club_claims_update_admin on public.club_claims for update
  using (public.is_site_admin());

-- club_join_requests: a user can submit their own; the target club's admin
-- or Site Admin reads/decides.
create policy club_join_requests_insert_self on public.club_join_requests for insert
  to authenticated with check (requesting_user_id = auth.uid());
create policy club_join_requests_select_scoped on public.club_join_requests for select
  using (public.is_site_admin() or public.is_club_admin(club_id));
create policy club_join_requests_update_scoped on public.club_join_requests for update
  using (public.is_site_admin() or public.is_club_admin(club_id));

-- directory_requests: a user can submit their own "can't find your club"
-- request; only Site Admin reviews.
create policy directory_requests_insert_self on public.directory_requests for insert
  to authenticated with check (submitted_by = auth.uid());
create policy directory_requests_select_admin on public.directory_requests for select
  using (public.is_site_admin());
create policy directory_requests_update_admin on public.directory_requests for update
  using (public.is_site_admin());

-- teams: public reads active teams; Site Admin/club admin read all,
-- create, and edit their own club's teams.
create policy teams_select_active on public.teams for select
  to anon, authenticated using (active = true);
create policy teams_select_admin on public.teams for select
  using (public.is_site_admin() or public.is_club_admin(club_id));
create policy teams_insert_admin on public.teams for insert
  with check (public.is_site_admin() or public.is_club_admin(club_id));
create policy teams_update_admin on public.teams for update
  using (public.is_site_admin() or public.is_club_admin(club_id));

-- team_contacts: public reads only rows marked is_public; Site Admin/club
-- admin (of the team's club) manage all.
create policy team_contacts_select_public on public.team_contacts for select
  to anon, authenticated using (is_public = true);
create policy team_contacts_select_admin on public.team_contacts for select
  using (public.is_site_admin() or public.is_club_admin((select club_id from public.teams where id = team_id)));
create policy team_contacts_write_admin on public.team_contacts for insert
  with check (public.is_site_admin() or public.is_club_admin((select club_id from public.teams where id = team_id)));
create policy team_contacts_update_admin on public.team_contacts for update
  using (public.is_site_admin() or public.is_club_admin((select club_id from public.teams where id = team_id)));
create policy team_contacts_delete_admin on public.team_contacts for delete
  using (public.is_site_admin() or public.is_club_admin((select club_id from public.teams where id = team_id)));

-- club_memberships: the member themself, the club's admin, or Site Admin
-- can read; role changes by club admin or Site Admin; creation is Site
-- Admin only for now (see clubs table comment above on the deferred
-- atomic-approval function).
create policy club_memberships_select_scoped on public.club_memberships for select
  using (user_id = auth.uid() or public.is_site_admin() or public.is_club_admin(club_id));
create policy club_memberships_insert_admin on public.club_memberships for insert
  with check (public.is_site_admin());
create policy club_memberships_update_scoped on public.club_memberships for update
  using (public.is_site_admin() or public.is_club_admin(club_id));

-- team_permissions: visible/manageable by Site Admin or the relevant club's
-- admin (resolved via the membership's club_id).
create policy team_permissions_select_scoped on public.team_permissions for select
  using (public.is_site_admin() or public.is_club_admin((select club_id from public.club_memberships where id = membership_id)));
create policy team_permissions_insert_scoped on public.team_permissions for insert
  with check (public.is_site_admin() or public.is_club_admin((select club_id from public.club_memberships where id = membership_id)));
create policy team_permissions_update_scoped on public.team_permissions for update
  using (public.is_site_admin() or public.is_club_admin((select club_id from public.club_memberships where id = membership_id)));

-- club_contacts: public reads only is_public rows; Site Admin/club admin
-- manage all.
create policy club_contacts_select_public on public.club_contacts for select
  to anon, authenticated using (is_public = true);
create policy club_contacts_select_admin on public.club_contacts for select
  using (public.is_site_admin() or public.is_club_admin(club_id));
create policy club_contacts_write_admin on public.club_contacts for insert
  with check (public.is_site_admin() or public.is_club_admin(club_id));
create policy club_contacts_update_admin on public.club_contacts for update
  using (public.is_site_admin() or public.is_club_admin(club_id));
create policy club_contacts_delete_admin on public.club_contacts for delete
  using (public.is_site_admin() or public.is_club_admin(club_id));

-- club_opponent_notes: never public. Only the owning club's admin or Site
-- Admin.
create policy club_opponent_notes_all_scoped on public.club_opponent_notes for all
  using (public.is_site_admin() or public.is_club_admin(owning_club_id))
  with check (public.is_site_admin() or public.is_club_admin(owning_club_id));

-- venues, competitions, seasons, competition_editions,
-- competition_edition_teams: public reads active/all rows; Site Admin only
-- writes (per the approved matrix, not delegated to club admins).
create policy venues_select_active on public.venues for select
  to anon, authenticated using (active = true);
create policy venues_select_admin on public.venues for select using (public.is_site_admin());
create policy venues_write_admin on public.venues for insert with check (public.is_site_admin());
create policy venues_update_admin on public.venues for update using (public.is_site_admin());

create policy competitions_select_active on public.competitions for select
  to anon, authenticated using (active = true);
create policy competitions_select_admin on public.competitions for select using (public.is_site_admin());
create policy competitions_write_admin on public.competitions for insert with check (public.is_site_admin());
create policy competitions_update_admin on public.competitions for update using (public.is_site_admin());

create policy seasons_select_all on public.seasons for select to anon, authenticated using (true);
create policy seasons_write_admin on public.seasons for insert with check (public.is_site_admin());
create policy seasons_update_admin on public.seasons for update using (public.is_site_admin());

create policy competition_editions_select_active on public.competition_editions for select
  to anon, authenticated using (active = true);
create policy competition_editions_select_admin on public.competition_editions for select using (public.is_site_admin());
create policy competition_editions_write_admin on public.competition_editions for insert with check (public.is_site_admin());
create policy competition_editions_update_admin on public.competition_editions for update using (public.is_site_admin());

create policy competition_edition_teams_select_all on public.competition_edition_teams for select
  to anon, authenticated using (true);
create policy competition_edition_teams_write_admin on public.competition_edition_teams for insert with check (public.is_site_admin());
create policy competition_edition_teams_delete_admin on public.competition_edition_teams for delete using (public.is_site_admin());

-- fixtures: public reads all rows (team calendars are public); writes by
-- Site Admin or anyone with manage permission on the owning team (e.g. a
-- fixture secretary). Deletes reserved for Site Admin only — published
-- fixtures should normally be cancelled via status, not deleted.
create policy fixtures_select_all on public.fixtures for select to anon, authenticated using (true);
create policy fixtures_insert_scoped on public.fixtures for insert
  with check (public.can_manage_team(owning_team_id));
create policy fixtures_update_scoped on public.fixtures for update
  using (public.can_manage_team(owning_team_id));
create policy fixtures_delete_admin on public.fixtures for delete
  using (public.is_site_admin());

-- fixture_source_refs, unresolved_names: internal ingestion/admin data,
-- never public.
create policy fixture_source_refs_all_admin on public.fixture_source_refs for all
  using (public.is_site_admin()) with check (public.is_site_admin());

create policy unresolved_names_select_admin on public.unresolved_names for select using (public.is_site_admin());
create policy unresolved_names_insert_admin on public.unresolved_names for insert with check (public.is_site_admin());
create policy unresolved_names_update_admin on public.unresolved_names for update using (public.is_site_admin());

-- terms_acceptances: a user reads/inserts their own; Site Admin reads all.
-- No update/delete policy — append-only by design.
create policy terms_acceptances_select_scoped on public.terms_acceptances for select
  using (user_id = auth.uid() or public.is_site_admin());
create policy terms_acceptances_insert_self on public.terms_acceptances for insert
  to authenticated with check (user_id = auth.uid());

-- audit_log: Site Admin read-only. No insert/update/delete policy for any
-- role — only the SECURITY DEFINER audit_row_change() trigger function
-- writes here, which runs as the function owner and is not subject to
-- these policies.
create policy audit_log_select_admin on public.audit_log for select using (public.is_site_admin());

-- Locks team naming to the canonical category list, and closes the real
-- gap behind "random" team names: club_claims.proposed_teams (what a
-- claimant told signup step 3 their club runs) was captured and stored,
-- but nothing ever read it -- approve_club_claim activated the club and
-- granted CLUB_ADMIN, then stopped. A human was left to manually re-create
-- matching teams afterward through a free-text "Team name" field, which is
-- exactly where drift/typos/inconsistent names came from. Both problems
-- share one fix: teams.display_name/slug become derived, not entered, and
-- claim approval now mechanically seeds real teams from the proposal
-- instead of leaving that step to a human's memory.
--
-- The category -> structured-field mapping here must stay in lockstep with
-- lib/teams/catalog.ts's TEAM_CATEGORY_GROUPS -- both are hand-written from
-- the same design (documented there: Mini & youth U6-U11 defaults to
-- mixed, Youth U12-U16 defaults to boys, Girls is explicit, senior ordinals
-- are fixed per option). Kept in two places because one is a Postgres
-- function and the other is a TS UI catalog; there is no single artifact
-- both could read.

-- ============================================================
-- 0. slug stops being a uniqueness key. It was never read anywhere in the
--    app (grepped: zero call sites -- team pages route by id, not slug),
--    so its only real job was accidental: whatever free text a human
--    happened to type usually differed enough to keep two rows' slugs
--    apart too. Deriving display_name (and therefore slug) purely from
--    the structured fields makes that accidental uniqueness break for a
--    real, legitimate case: compactTeamLabel() deliberately shows no
--    gender word for boys/mixed/null (only "Girls" is ever shown), so a
--    genuine "U8 Boys" team and a genuine "U8 Mixed" team -- two different
--    real sides, correctly kept apart by identity_key, which IS
--    gender-aware -- now compute the identical slug "u8". identity_key's
--    unique(club_id, identity_key) is the real one-team-per-combination
--    guarantee; slug was redundant with it and is now strictly weaker.
-- ============================================================

alter table public.teams drop constraint teams_club_id_slug_key;

-- ============================================================
-- 1. display_name/slug become derived from the structured fields, always
--    -- no insert or update path (app-layer or SQL) can leave them out of
--    sync with category/age_group/gender/squad_designation again.
-- ============================================================

create or replace function internal.compute_team_display_name(
  p_category text, p_age_group text, p_gender text, p_squad_designation text
) returns text
language sql
immutable
as $$
  select case
    when p_category = 'senior' then
      (case when p_gender = 'womens' then 'Women''s' else 'Men''s' end)
        || ' ' || coalesce(nullif(p_squad_designation, ''), '1st')
    else
      (case when p_gender = 'girls' then 'Girls ' else '' end)
        || coalesce(p_age_group, 'Team')
        || (case when nullif(p_squad_designation, '') is not null then ' ' || p_squad_designation else '' end)
  end
$$;

comment on function internal.compute_team_display_name is
  'The one place a team display name is computed -- mirrors lib/teams/compact-label.ts''s compactTeamLabel() exactly. "Boys"/"Mixed" never appear; "Girls" always does, always first.';

create or replace function internal.teams_set_display_name() returns trigger
language plpgsql
as $$
begin
  new.display_name := internal.compute_team_display_name(new.category, new.age_group, new.gender, new.squad_designation);
  new.slug := trim(both '-' from regexp_replace(lower(new.display_name), '[^a-z0-9]+', '-', 'g'));
  return new;
end;
$$;

drop trigger if exists teams_set_display_name_trigger on public.teams;
create trigger teams_set_display_name_trigger
  before insert or update of category, age_group, gender, squad_designation on public.teams
  for each row execute function internal.teams_set_display_name();

comment on trigger teams_set_display_name_trigger on public.teams is
  'Recomputes display_name/slug from the structured fields on every insert, and on every update that touches them (rollover''s plain age_group UPDATE included) -- a client-supplied display_name is always overwritten, never trusted.';

-- One-time backfill: bring every existing row's display_name/slug in line
-- with its own structured fields right now, rather than waiting for a
-- future update to touch it.
update public.teams
set display_name = internal.compute_team_display_name(category, age_group, gender, squad_designation),
    slug = trim(both '-' from regexp_replace(lower(internal.compute_team_display_name(category, age_group, gender, squad_designation)), '[^a-z0-9]+', '-', 'g'));

-- ============================================================
-- 2. internal.seed_teams_from_proposal -- turns a claim's proposed_teams
--    ([{category, additionalLetters}], category being the exact label
--    text from the signup picker, e.g. "Under 12 Girls") into real teams
--    rows. Unrecognised labels (a legacy/removed category, e.g. the old
--    "Colts" checkbox -- see catalog.ts) are skipped, never guessed at.
--    Idempotent via the pre-existing (club_id, identity_key) unique
--    constraint, so re-running against a club that already has some teams
--    never errors or duplicates.
-- ============================================================

create or replace function internal.seed_teams_from_proposal(p_club_id uuid, p_rugby_code text, p_proposed_teams jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_letter text;
  v_created integer := 0;
  v_category text;
  v_age_group text;
  v_gender text;
  v_squad text;
begin
  if p_proposed_teams is null then return 0; end if;

  for v_item in select * from jsonb_array_elements(p_proposed_teams)
  loop
    select t.category, t.age_group, t.gender, t.squad
      into v_category, v_age_group, v_gender, v_squad
    from (values
      ('Under 6', 'youth', 'U6', 'mixed', null),
      ('Under 7', 'youth', 'U7', 'mixed', null),
      ('Under 8', 'youth', 'U8', 'mixed', null),
      ('Under 9', 'youth', 'U9', 'mixed', null),
      ('Under 10', 'youth', 'U10', 'mixed', null),
      ('Under 11', 'youth', 'U11', 'mixed', null),
      ('Under 12', 'youth', 'U12', 'boys', null),
      ('Under 13', 'youth', 'U13', 'boys', null),
      ('Under 14', 'youth', 'U14', 'boys', null),
      ('Under 15', 'youth', 'U15', 'boys', null),
      ('Under 16', 'youth', 'U16', 'boys', null),
      ('Under 12 Girls', 'youth', 'U12', 'girls', null),
      ('Under 13 Girls', 'youth', 'U13', 'girls', null),
      ('Under 14 Girls', 'youth', 'U14', 'girls', null),
      ('Under 15 Girls', 'youth', 'U15', 'girls', null),
      ('Under 16 Girls', 'youth', 'U16', 'girls', null),
      ('Men''s 1st Team', 'senior', null, 'mens', '1st'),
      ('Men''s 2nd Team', 'senior', null, 'mens', '2nd'),
      ('Men''s 3rd Team', 'senior', null, 'mens', '3rd'),
      ('Women''s 1st Team', 'senior', null, 'womens', '1st'),
      ('Women''s 2nd Team', 'senior', null, 'womens', '2nd'),
      ('Women''s 3rd Team', 'senior', null, 'womens', '3rd')
    ) as t(label, category, age_group, gender, squad)
    where t.label = (v_item->>'category');

    if v_category is null then
      continue;
    end if;

    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
    values (p_club_id, p_rugby_code, v_category, v_age_group, v_gender, v_squad, 'pending', 'pending', auth.uid(), auth.uid())
    on conflict (club_id, identity_key) do nothing;
    if found then v_created := v_created + 1; end if;

    if v_category = 'youth' then
      for v_letter in select jsonb_array_elements_text(coalesce(v_item->'additionalLetters', '[]'::jsonb))
      loop
        insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
        values (p_club_id, p_rugby_code, v_category, v_age_group, v_gender, v_letter, 'pending', 'pending', auth.uid(), auth.uid())
        on conflict (club_id, identity_key) do nothing;
        if found then v_created := v_created + 1; end if;
      end loop;
    end if;

    v_category := null;
  end loop;

  return v_created;
end;
$$;

comment on function internal.seed_teams_from_proposal is
  'Turns a claim''s proposed_teams into real teams rows -- called once from approve_club_claim. display_name/slug are placeholders here; teams_set_display_name_trigger computes the real values on the same insert.';

revoke execute on function internal.seed_teams_from_proposal(uuid, text, jsonb) from public;

-- ============================================================
-- 3. approve_club_claim now seeds real teams from the claim's own
--    proposed_teams immediately after the club is activated -- the missing
--    connection between "what the claimant said they run" and "what
--    actually exists in Teams/Fixtures/Calendar". Everything else about
--    this function (club/membership creation, status update, notification)
--    is unchanged from 20260831090000.
-- ============================================================

create or replace function public.approve_club_claim(p_claim_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.club_claims;
  v_club_id uuid;
  v_club_name text;
  v_rugby_code text;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may approve a club claim.' using errcode = '42501';
  end if;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'Claim is not pending (current status: %).', v_claim.status;
  end if;

  select c.id, cd.name, cd.rugby_code into v_club_id, v_club_name, v_rugby_code from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.directory_id = v_claim.directory_id;

  if v_club_id is null then
    select cd.name, cd.rugby_code into v_club_name, v_rugby_code from public.club_directory cd where cd.id = v_claim.directory_id;
    insert into public.clubs (directory_id, slug, status, created_by, updated_by)
    values (v_claim.directory_id, internal.generate_club_slug(v_club_name), 'active', auth.uid(), auth.uid())
    returning id into v_club_id;
  end if;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_club_id, v_claim.claimant_user_id, 'CLUB_ADMIN', 'active', auth.uid(), auth.uid())
  on conflict (club_id, user_id) do update set role = 'CLUB_ADMIN', status = 'active', updated_by = auth.uid();

  perform internal.seed_teams_from_proposal(v_club_id, v_rugby_code, v_claim.proposed_teams);

  update public.club_claims
  set status = 'verified', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_claim_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_claim.claimant_user_id,
    'club_claim_approved',
    'Club claim approved',
    format('Your access to %s has been approved.', v_club_name),
    jsonb_build_object('club_id', v_club_id, 'claim_id', p_claim_id)
  );

  return v_club_id;
end;
$$;

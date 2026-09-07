-- First-run setup must accept the crest a club already has.
--
-- club_setup_requirements.has_logo checked `clubs.logo_storage_path` alone.
-- But the canonical rule for "which stored path is this club's logo" is the
-- one lib/app-context/club-logo.ts states: the club's own upload if there
-- is one, otherwise the Club Directory's crest, which a Site Admin can set
-- for any recognised club whether or not it has claimed itself.
--
-- So a club whose crest a Site Admin had already set was shown that crest
-- everywhere in the product -- nav, fixture cards, its public page -- and
-- was then stopped at step 1 of first-run setup and told to upload a logo,
-- with the wizard displaying no crest at all because it read the same
-- single column. The club's own logo was, from its point of view, missing
-- the moment it signed up.
--
-- No club is affected on this database today (0 claimed clubs have a
-- directory crest and no crest of their own), so this is a latent defect
-- being closed before it bites rather than a live repair.
--
-- Only the has_logo branch changes. Every other requirement, the step
-- arithmetic and the authorization check are re-declared byte-identical
-- because this function is one statement -- there is no way to change one
-- branch without restating it.

create or replace function public.club_setup_requirements(p_club_id uuid)
returns table (
  has_logo boolean,
  has_primary_kit boolean,
  has_default_venue boolean,
  default_venue_has_address boolean,
  default_venue_has_pitch boolean,
  teams_confirmed boolean,
  step1_complete boolean,
  step2_complete boolean,
  step3_complete boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_default uuid;
  v_logo boolean;
  v_kit boolean;
  v_addr boolean;
  v_pitch boolean;
  v_teams boolean;
begin
  if not (internal.is_site_admin() or exists (
    select 1 from public.club_memberships cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active'
  )) then
    raise exception 'Not authorized to read this club''s setup state.' using errcode = '42501';
  end if;

  -- The club's OWN crest, or the Club Directory crest it inherits. This is
  -- resolveClubLogoPath()'s rule expressed in SQL; the two must agree, or
  -- the wizard demands something the rest of the product already shows.
  select (
    coalesce(nullif(btrim(c.logo_storage_path), ''), nullif(btrim(d.logo_storage_path), '')) is not null
  )
  into v_logo
  from public.clubs c
  left join public.club_directory d on d.id = c.directory_id
  where c.id = p_club_id;

  select exists (
    select 1 from public.club_kits k where k.club_id = p_club_id and k.variant = 'primary'
  ) into v_kit;

  select v.id into v_default
  from public.venues v
  where v.club_id = p_club_id and v.is_default_home = true and v.active = true
  limit 1;

  select v_default is not null and exists (
    select 1 from public.venues v
    where v.id = v_default
      and coalesce(nullif(btrim(v.postcode), ''), '') <> ''
      and (
        coalesce(nullif(btrim(v.address_line_1), ''), '') <> ''
        or coalesce(nullif(btrim(v.address), ''), '') <> ''
      )
  ) into v_addr;

  select v_default is not null and exists (
    select 1 from public.club_pitches p
    where p.venue_id = v_default and p.active = true
  ) into v_pitch;

  select s.teams_confirmed_at is not null into v_teams
  from public.club_setup_state s where s.club_id = p_club_id;

  has_logo := coalesce(v_logo, false);
  has_primary_kit := coalesce(v_kit, false);
  has_default_venue := v_default is not null;
  default_venue_has_address := coalesce(v_addr, false);
  default_venue_has_pitch := coalesce(v_pitch, false);
  teams_confirmed := coalesce(v_teams, false);

  step1_complete := has_logo and has_primary_kit;
  step2_complete := has_default_venue and default_venue_has_address and default_venue_has_pitch;
  step3_complete := teams_confirmed;

  return next;
end;
$$;

revoke execute on function public.club_setup_requirements(uuid) from public, anon;
grant execute on function public.club_setup_requirements(uuid) to authenticated;

comment on function public.club_setup_requirements is
  'The single source of truth for whether a club is set up. Every requirement is re-derived from canonical data on each call. has_logo honours the club''s OWN crest or the Club Directory crest it inherits -- the same rule lib/app-context/club-logo.ts applies everywhere else, so setup never demands a crest the product is already displaying.';

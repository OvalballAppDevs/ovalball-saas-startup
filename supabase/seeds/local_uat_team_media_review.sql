-- Local UAT data for TEAM PROFILE MEDIA PHYSICAL REVIEW (Section 5).
--
-- WHY THIS FILE EXISTS
--
-- Sets Women's 1st Team's cover to a deliberate Ovalball Image Library selection (cover_stock_key),
-- so "a team using an Ovalball library cover" can be reviewed without touching storage -- a stock
-- cover is pure metadata referencing the bundled local catalogue
-- (apps/mobile/src/team/cover-library.ts), never a storage object. Under 12 Boys is deliberately left
-- with no cover_image_path/cover_stock_key of its own, so its own Edit Cover Photo (upload/take/choose
-- Ovalball Image Library) and its Team Gallery (real uploaded photos) can both be exercised live and
-- freshly during physical review, rather than starting from an already-set state.
--
-- Team Gallery photos are NOT seeded here: a team_media row without a real object in the private
-- team-gallery-media bucket would be a broken reference (a signed URL that resolves to nothing), and
-- storage objects cannot be created from a plain SQL seed. Real gallery photos are added live, through
-- the app's own Add Photos flow, during physical review -- see the Section 5 report's UAT DATA field.

do $$
begin
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual','official_club') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The Team Media review UAT seed is local-only.';
  end if;
end $$;

do $$
declare
  v_womens_team uuid := 'c06be292-cebb-4bcc-bfca-81258cfaf100'; -- Women's 1st Team, Ovalball UAT RUFC
begin
  if not exists (select 1 from public.teams where id = v_womens_team) then
    return; -- the exact review team this seed enriches doesn't exist in this database; nothing to add.
  end if;

  update public.teams
  set cover_image_path = null,
      cover_stock_key = 'rugby-team-huddle-womens-01'
  where id = v_womens_team
    and coalesce(cover_stock_key, '') <> 'rugby-team-huddle-womens-01';
end $$;

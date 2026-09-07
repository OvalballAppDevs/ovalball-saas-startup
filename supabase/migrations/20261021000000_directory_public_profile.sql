-- Site Admin club profile override: the last two public-profile fields a
-- recognised-but-unclaimed club could not have.
--
-- THE GAP
--
-- `club_directory` holds every recognised club (1,400+); `clubs` holds only
-- the ones activated on Ovalball (43). A Site Admin could already maintain
-- an unclaimed club's name, town, county, home ground, address, postcode,
-- website, official email and CREST -- all on `club_directory`.
--
-- Two public-profile fields existed only on `clubs`: `bio` and
-- `facebook_url`. So the one thing a Site Admin could not do for a club
-- that had not claimed itself was write a description of it or link its
-- Facebook page. The alternative -- creating a `clubs` row to hold them --
-- would fabricate an activated club that nobody has claimed, corrupting
-- every activated-club count on the platform. Hence two columns here
-- instead.
--
-- THE PATTERN THIS FOLLOWS
--
-- Exactly the one `logo_storage_path` already establishes: the field lives
-- on BOTH tables, the club's own value wins, and the directory's value is
-- the seed/fallback underneath it. lib/app-context/club-logo.ts is the
-- canonical resolver for that pair; lib/app-context/club-public-profile.ts
-- is the equivalent for these. Nothing is copied between the two tables and
-- there is no sync step -- resolution happens at read time, so a club that
-- later claims itself and writes its own bio simply starts winning.

alter table public.club_directory add column if not exists bio text;
alter table public.club_directory add column if not exists facebook_url text;

comment on column public.club_directory.bio is
  'Directory-level description of a recognised club, maintained by a Site Admin. The SEED/FALLBACK for clubs.bio -- an activated club that writes its own bio wins. Resolved by lib/app-context/club-public-profile.ts, never copied between the tables.';

comment on column public.club_directory.facebook_url is
  'Directory-level Facebook page for a recognised club, maintained by a Site Admin. The SEED/FALLBACK for clubs.facebook_url, resolved the same way as bio and logo_storage_path.';

-- No new policy, grant or RPC. `club_directory_update_admin`
-- (internal.is_site_admin()) already governs every column on this table,
-- and internal.audit_row_change() already logs the row. Adding a column to
-- a table whose authorization and auditing are already correct should not
-- invent a second mechanism for that column.

-- ---------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------

do $$
begin
  -- The point of the whole change: these two must be nullable and carry no
  -- default, so a directory row means "no directory-level value" rather
  -- than "an empty bio that beats the club's own".
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'club_directory'
      and column_name in ('bio', 'facebook_url')
      and (is_nullable = 'NO' or column_default is not null)
  ) then
    raise exception 'club_directory.bio/facebook_url must be nullable with no default -- an empty string would outrank a club''s own value.';
  end if;

  -- And the fallback only means anything if both tables still carry the
  -- field. If a later migration drops either side, the resolver silently
  -- becomes a single-table read.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clubs' and column_name = 'bio'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clubs' and column_name = 'facebook_url'
  ) then
    raise exception 'clubs.bio / clubs.facebook_url are missing -- the directory fallback has nothing to fall back from.';
  end if;
end;
$$;

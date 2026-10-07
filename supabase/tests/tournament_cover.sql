-- A tournament has its own photograph, and only its own club may change it.
--
-- THE RULE
--
-- A tournament's cover is the pair every other photographed entity already uses: `cover_image_path`
-- for an upload and `cover_stock_key` for an Ovalball Image Library selection, never both, written
-- only through `set_tournament_cover`. Null for both is not an absence to fix -- it is "nobody has
-- chosen", which the client resolves to the canonical default and which must therefore SURVIVE rather
-- than being backfilled with the default's key.
--
-- WHAT THIS PROVES
--
--   A. the two columns exist and are mutually exclusive at the table, not only in the RPC;
--   B. a library selection round-trips, and an unrecognised key is refused;
--   C. an upload path that was not minted for THIS tournament is refused;
--   D. clearing goes back to null rather than to the default's key;
--   E. a club cannot change another club's tournament photograph, and the storage-path matcher
--      refuses a path whose club does not host the tournament it names;
--   F. existing tournaments keep a null cover -- the migration photographs nothing.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_hdir uuid; v_hclub uuid; v_venue uuid;
  v_odir uuid; v_oclub uuid;
  v_t uuid; v_n int; v_ok boolean; v_path text;
begin

-- ---- the host club and its admin -------------------------------------------------------------------
insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'cover@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Cover','Test','cover@ovalball-test.invalid');

insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('Cover Host RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','chost-'||substr(gen_random_uuid()::text,1,8)) returning id into v_hdir;
insert into public.clubs (directory_id,slug,status) values (v_hdir,'chost-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_hclub;
insert into public.club_memberships (user_id,club_id,role,status) values (v_admin,v_hclub,'CLUB_ADMIN','active');
insert into public.venues (club_id,name,slug,active) values (v_hclub,'Cover Ground','cg-'||substr(gen_random_uuid()::text,1,8),true) returning id into v_venue;

-- ---- a second, unrelated club and its admin --------------------------------------------------------
insert into auth.users (id, email, instance_id, aud, role)
values (v_other,'cover2@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_other,'Other','Club','cover2@ovalball-test.invalid');
insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('Cover Other RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cother-'||substr(gen_random_uuid()::text,1,8)) returning id into v_odir;
insert into public.clubs (directory_id,slug,status) values (v_odir,'cother-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_oclub;
insert into public.club_memberships (user_id,club_id,role,status) values (v_other,v_oclub,'CLUB_ADMIN','active');

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

-- =====================================================================================================
-- A. A TOURNAMENT STARTS WITH NO PHOTOGRAPH, and that is a real state rather than a gap.
-- =====================================================================================================

v_t := public.save_tournament(v_hclub,'Cover Festival',current_date,null,'union',null,null,null,v_venue,null,null,'round_robin','09:00','private');

select count(*) into v_n from public.tournaments where id=v_t and cover_image_path is null and cover_stock_key is null;
if v_n=1 then raise notice 'PASS 1 (A): a new tournament has no photograph of its own, and resolves to the default';
else raise notice 'FAIL 1 (A): a new tournament was given a cover it did not choose'; end if;

-- The exclusivity is on the TABLE, so no future writer can leave a row holding two answers.
begin
  update public.tournaments set cover_image_path='x/tournament-y/z.jpg', cover_stock_key='tournament-posts-morning-01' where id=v_t;
  raise notice 'FAIL 2 (A): a row held an upload AND a library key at the same time';
exception when check_violation then
  raise notice 'PASS 2 (A): a cover is an upload or a library image, never both -- refused by the table';
end;

-- =====================================================================================================
-- B. A LIBRARY SELECTION round-trips; a key Ovalball does not ship is refused.
-- =====================================================================================================

perform public.set_tournament_cover(v_t, null, 'tournament-trophy-table-01');
select count(*) into v_n from public.tournaments where id=v_t and cover_stock_key='tournament-trophy-table-01' and cover_image_path is null;
if v_n=1 then raise notice 'PASS 3 (B): an Ovalball library selection is stored as the tournament''s photograph';
else raise notice 'FAIL 3 (B): the library selection did not persist'; end if;

begin
  perform public.set_tournament_cover(v_t, null, 'tournament-not-a-real-image');
  raise notice 'FAIL 4 (B): an unrecognised library key was accepted';
exception when others then
  raise notice 'PASS 4 (B): a key with no photograph behind it is refused by the server, not just the app';
end;

-- Choosing again REPLACES rather than accumulating -- there is one selection, not a history of them.
perform public.set_tournament_cover(v_t, null, 'tournament-posts-morning-01');
select count(*) into v_n from public.tournaments where id=v_t and cover_stock_key='tournament-posts-morning-01';
if v_n=1 then raise notice 'PASS 5 (B): choosing again replaces the selection -- one photograph, not two';
else raise notice 'FAIL 5 (B): the second selection did not replace the first'; end if;

-- =====================================================================================================
-- C. AN UPLOAD PATH MUST HAVE BEEN MINTED FOR THIS TOURNAMENT.
-- =====================================================================================================

v_path := v_hclub::text || '/tournament-' || v_t::text || '/' || gen_random_uuid()::text || '.jpg';
perform public.set_tournament_cover(v_t, v_path, null);
select count(*) into v_n from public.tournaments where id=v_t and cover_image_path=v_path and cover_stock_key is null;
if v_n=1 then raise notice 'PASS 6 (C): an upload for this tournament is accepted, and clears the library selection';
else raise notice 'FAIL 6 (C): the uploaded path did not persist'; end if;

begin
  -- Right club, WRONG tournament in the path.
  perform public.set_tournament_cover(v_t, v_hclub::text || '/tournament-' || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.jpg', null);
  raise notice 'FAIL 7 (C): a photo uploaded for a different tournament was accepted';
exception when others then
  raise notice 'PASS 7 (C): a photo not uploaded for THIS tournament is refused';
end;

begin
  -- A path that is not a uuid filename at all.
  perform public.set_tournament_cover(v_t, v_hclub::text || '/tournament-' || v_t::text || '/../../secrets.jpg', null);
  raise notice 'FAIL 8 (C): a path outside the tournament''s own folder was accepted';
exception when others then
  raise notice 'PASS 8 (C): a path that does not match the governed shape is refused';
end;

-- =====================================================================================================
-- D. CLEARING GOES BACK TO NULL, not to the default's key.
-- =====================================================================================================

perform public.set_tournament_cover(v_t, null, null);
select count(*) into v_n from public.tournaments where id=v_t and cover_image_path is null and cover_stock_key is null;
if v_n=1 then raise notice 'PASS 9 (D): resetting clears both columns, so the tournament follows the default again';
else raise notice 'FAIL 9 (D): resetting left a value behind'; end if;

-- =====================================================================================================
-- E. ONLY THE HOSTING CLUB MAY CHANGE IT.
-- =====================================================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_other,'role','authenticated')::text, true);

v_ok := false;
begin
  perform public.set_tournament_cover(v_t, null, 'tournament-match-action-01');
exception when others then v_ok := true;
end;
select count(*) into v_n from public.tournaments where id=v_t and cover_stock_key is null;
if v_ok and v_n=1 then raise notice 'PASS 10 (E): another club cannot change this tournament''s photograph, and nothing was written';
else raise notice 'FAIL 10 (E): refused=%, still null=%', v_ok, v_n; end if;

-- The storage-path matcher is the same authority, reached the way the bucket policy reaches it.
if internal.may_manage_tournament_media(v_oclub::text || '/tournament-' || v_t::text || '/' || gen_random_uuid()::text || '.jpg') then
  raise notice 'FAIL 11 (E): a club could write into storage for a tournament it does not host';
else
  raise notice 'PASS 11 (E): the storage path matcher refuses a club writing for a tournament it does not host';
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
if internal.may_manage_tournament_media(v_hclub::text || '/tournament-' || v_t::text || '/' || gen_random_uuid()::text || '.jpg') then
  raise notice 'PASS 12 (E): the hosting club''s own admin may write its tournament''s photo to storage';
else
  raise notice 'FAIL 12 (E): the hosting club was refused its own tournament''s storage path';
end if;

if internal.may_manage_tournament_media(v_hclub::text || '/tournament-' || v_t::text || '/notauuid.exe') then
  raise notice 'FAIL 13 (E): a non-image filename was accepted by the storage path matcher';
else
  raise notice 'PASS 13 (E): the storage path matcher refuses anything but a uuid-named image';
end if;

-- =====================================================================================================
-- F. THE MIGRATION PHOTOGRAPHS NOTHING.
--
-- Existing tournaments must keep working without being given an image at migration time, so that they
-- receive the default and newly configured ones become visually distinct. A backfill would turn
-- "nobody has chosen" into "somebody chose this" for every tournament that already existed.
-- =====================================================================================================

select count(*) into v_n from public.tournaments where cover_stock_key = 'tournament-card-01';
if v_n=0 then raise notice 'PASS 14 (F): the default was never written into any tournament -- it stays the fallback';
else raise notice 'FAIL 14 (F): % tournaments were stamped with the default image key', v_n; end if;


-- =====================================================================================================
-- G. ONE SIGNATURE PER WRITE FUNCTION.
--
-- `create or replace function` with a new TRAILING parameter does not replace anything -- it adds a
-- second overload beside the first, and because both carry defaults, every existing positional caller
-- then fails with "function … is not unique". That is a failure of the whole function rather than of
-- the new argument, and it is invisible until something calls it. It happened when the cover key was
-- added, so it is asserted here rather than remembered.
-- =====================================================================================================

select count(*) into v_n from pg_proc where proname = 'create_tournament_with_teams';
if v_n = 1 then raise notice 'PASS 15 (G): create_tournament_with_teams has exactly one signature';
else raise notice 'FAIL 15 (G): % overloads of create_tournament_with_teams -- positional callers will break', v_n; end if;

select count(*) into v_n from pg_proc where proname = 'save_tournament';
if v_n = 1 then raise notice 'PASS 16 (G): save_tournament has exactly one signature';
else raise notice 'FAIL 16 (G): % overloads of save_tournament', v_n; end if;

select count(*) into v_n from pg_proc where proname = 'set_tournament_cover';
if v_n = 1 then raise notice 'PASS 17 (G): set_tournament_cover has exactly one signature';
else raise notice 'FAIL 17 (G): % overloads of set_tournament_cover', v_n; end if;


-- =====================================================================================================
-- H. A TOURNAMENT AGE GROUP IS A REAL AGE GROUP.
--
-- Both grade columns were plain text with no vocabulary behind them, so the canonical RPC accepted
-- 'U99', 'BANANA' and 'under twelve' and wrote three rows. Only the mobile wizard's own list stood in
-- the way, and a list in one client is not a constraint: the website, an import, a script or simply a
-- newer app reaches the same table without passing it.
-- =====================================================================================================

begin
  perform public.set_tournament_age_groups(v_t, array['U99']);
  raise notice 'FAIL 18 (H): an age grade that cannot exist was accepted';
exception when check_violation then
  raise notice 'PASS 18 (H): an age grade outside the canonical vocabulary is refused by the database';
end;

begin
  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  values (v_t, 'under twelve', v_admin);
  raise notice 'FAIL 19 (H): free text was accepted as an age grade by a direct write';
exception when check_violation then
  raise notice 'PASS 19 (H): free text is refused even by an authorised direct write';
end;

-- The vocabulary is the schema's own, so everything it legitimately produces still passes.
if internal.is_tournament_age_group('U6') and internal.is_tournament_age_group('U19')
   and internal.is_tournament_age_group('JuniorColts') and internal.is_tournament_age_group('SeniorColts')
   and internal.is_tournament_age_group('SENIOR') then
  raise notice 'PASS 20 (H): every grade the schema itself can produce is still accepted';
else
  raise notice 'FAIL 20 (H): the constraint refuses a grade the database derives on its own';
end if;

if internal.is_tournament_age_group('u12') or internal.is_tournament_age_group('U5')
   or internal.is_tournament_age_group('U20') or internal.is_tournament_age_group(null) then
  raise notice 'FAIL 21 (H): the vocabulary accepts a grade outside it';
else
  raise notice 'PASS 21 (H): internal keys, out-of-range grades and null are all refused';
end if;


-- =====================================================================================================
-- I. REPLACING A COVER BEHAVES THE SAME WAY IT DOES EVERYWHERE ELSE.
--
-- Replacing an uploaded cover leaves the superseded object in the bucket. That is true of venue, team
-- and pitch covers too -- none of those setters touches storage either; they update a row and audit it.
-- Whether the estate SHOULD sweep superseded cover objects is a real question, but it is one question
-- about four entities, not a tournament question.
--
-- SO THIS ASSERTS PARITY, NOT RETENTION. It fails if tournament covers ever diverge from the estate in
-- either direction: if tournaments alone start deleting objects (a tournament-only cleanup semantic,
-- invented here), or if the estate adopts cleanup and tournaments are left behind.
-- =====================================================================================================

declare v_tourn bool; v_venue_fn bool; v_team bool;
begin
  select pg_get_functiondef(oid) ilike '%storage%' into v_tourn from pg_proc where proname='set_tournament_cover';
  select pg_get_functiondef(oid) ilike '%storage%' into v_venue_fn from pg_proc where proname='set_venue_cover';
  select pg_get_functiondef(oid) ilike '%storage%' into v_team from pg_proc where proname='set_team_cover';

  if v_tourn = v_venue_fn and v_tourn = v_team then
    raise notice 'PASS 22 (I): a tournament cover is replaced exactly as a venue or team cover is -- no tournament-only storage semantics';
  else
    raise notice 'FAIL 22 (I): tournament=%, venue=%, team=% -- tournament covers have diverged from the estate', v_tourn, v_venue_fn, v_team;
  end if;
end;

end $$;
rollback;

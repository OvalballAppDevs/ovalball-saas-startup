-- "Not configured" is not "no warm-up required".
--
-- THE RULE
--
-- A club's scheduling buffers resolve through exactly one hierarchy:
--
--   CLUB OVERRIDE      public.club_scheduling_policy, where set
--   PLATFORM DEFAULT   public.platform_scheduling_defaults
--
-- and NEVER silently to zero. The original Pitch Allocation regression was
-- precisely that: a club with no policy row fell back to a code constant of
-- 0/0, the warm-up and pack-up bands rendered as zero-width, and the feature
-- looked deleted. Worse, that invented zero then drove conflict detection,
-- auto-allocation and Move validation as though the club had decided it.
--
-- There are three states a club can be in, and all three must resolve to a
-- real number:
--
--   a number   this club decided this          -> 'club'
--   NULL       this club has a row, but has not decided these
--   no row     this club has not decided anything
--
-- The last two both inherit the platform default and both report 'platform',
-- because an inherited value must never be reported as a club's own choice.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_nobody uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_narrow uuid := gen_random_uuid();
  v_warm int; v_pack int; v_source text;
  v_slug text := substr(gen_random_uuid()::text, 1, 8);
  v_blocked boolean;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin,'sbf-admin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_nobody,'sbf-nobody@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_admin,'Sbf','Admin','sbf-admin@ovalball-test.invalid'),
  (v_nobody,'Sbf','Nobody','sbf-nobody@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');

-- A NARROW Site Admin. Exists to do club data work; the platform-wide
-- scheduling default is not theirs to change.
insert into auth.users (id, email, instance_id, aud, role)
values (v_narrow,'sbf-narrow@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email)
values (v_narrow,'Sbf','Narrow','sbf-narrow@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_narrow,'active','club_data');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('SBF RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','sbf-'||v_slug)
returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'sbf-'||v_slug,'active') returning id into v_club;

-- ============ A. EXACTLY ONE PLATFORM ANSWER ============

select count(*) into v_warm from public.platform_scheduling_defaults;
if v_warm = 1 then
  raise notice 'PASS 1 (A): there is exactly one platform scheduling default row';
else
  raise notice 'FAIL 1 (A): % platform default rows -- a second is a second answer', v_warm;
end if;

begin
  insert into public.platform_scheduling_defaults (id, warm_up_minutes, pack_up_minutes) values (false, 5, 5);
  raise notice 'FAIL 2 (A): a second platform default row was accepted';
exception when others then
  raise notice 'PASS 2 (A): a second platform default row is refused by the database';
end;

-- ============ B. NO CLUB ROW -- THE ORIGINAL FAILURE CONDITION ============
--
-- This is the exact state the club was in when the bands disappeared.

select warm_up_minutes, pack_up_minutes, source
  into v_warm, v_pack, v_source
from public.resolve_club_scheduling_buffers(v_club);

if v_warm > 0 and v_pack > 0 and v_source = 'platform' then
  raise notice 'PASS 3 (B): a club with NO policy row inherits real platform buffers (%/%), never 0/0', v_warm, v_pack;
else
  raise notice 'FAIL 3 (B): no-row club resolved to %/% from % -- the silent-zero regression is back', v_warm, v_pack, v_source;
end if;

-- ============ C. A ROW WITH UNSET BUFFERS STILL INHERITS ============
--
-- The row exists for auto_allocate_home_fixtures and the kickoff windows. It
-- must not be read as "this club chose no warm-up" just because it exists.

insert into public.club_scheduling_policy (club_id, auto_allocate_home_fixtures)
values (v_club, true);

select warm_up_minutes, pack_up_minutes, source
  into v_warm, v_pack, v_source
from public.resolve_club_scheduling_buffers(v_club);

if v_warm > 0 and v_pack > 0 and v_source = 'platform' then
  raise notice 'PASS 4 (C): a club row with unset buffers still inherits the platform default, and is reported as inherited';
else
  raise notice 'FAIL 4 (C): row-with-unset-buffers resolved to %/% from %', v_warm, v_pack, v_source;
end if;

-- The columns must genuinely allow "unset". A NOT NULL DEFAULT 0 would write
-- a zero nobody chose the moment any other field on this row was saved.
if (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='club_scheduling_policy' and column_name='warm_up_minutes') = 'YES'
   and (select column_default from information_schema.columns
    where table_schema='public' and table_name='club_scheduling_policy' and column_name='warm_up_minutes') is null then
  raise notice 'PASS 5 (C): warm_up_minutes is nullable with no default -- unset is expressible and is not zero';
else
  raise notice 'FAIL 5 (C): warm_up_minutes still defaults, so saving any other field writes a buffer nobody chose';
end if;

-- ============ D. A REAL OVERRIDE WINS, AND SAYS SO ============

update public.club_scheduling_policy set warm_up_minutes = 30, pack_up_minutes = 25 where club_id = v_club;
select warm_up_minutes, pack_up_minutes, source
  into v_warm, v_pack, v_source
from public.resolve_club_scheduling_buffers(v_club);

if v_warm = 30 and v_pack = 25 and v_source = 'club' then
  raise notice 'PASS 6 (D): a club override wins and is reported as the club''s own';
else
  raise notice 'FAIL 6 (D): override resolved to %/% from %', v_warm, v_pack, v_source;
end if;

-- A DELIBERATE ZERO IS HONOURED. This is the distinction the whole hierarchy
-- rests on: nobody may have zero forced on them, but a club that genuinely
-- wants none must be able to say so and be believed.
update public.club_scheduling_policy set warm_up_minutes = 0, pack_up_minutes = 0 where club_id = v_club;
select warm_up_minutes, pack_up_minutes, source
  into v_warm, v_pack, v_source
from public.resolve_club_scheduling_buffers(v_club);

if v_warm = 0 and v_pack = 0 and v_source = 'club' then
  raise notice 'PASS 7 (D): a club that deliberately chooses zero gets zero -- chosen zero is not overridden';
else
  raise notice 'FAIL 7 (D): deliberate zero resolved to %/% from %', v_warm, v_pack, v_source;
end if;

-- ============ E. ONLY PLATFORM AUTHORITY CHANGES THE DEFAULT ============

perform set_config('role','authenticated',true);
perform set_config('request.jwt.claims', json_build_object('sub', v_nobody, 'role','authenticated')::text, true);
begin
  perform public.set_platform_scheduling_defaults(45, 45);
  raise notice 'FAIL 8 (E): an ordinary user changed the platform scheduling default';
exception when others then
  raise notice 'PASS 8 (E): changing the platform default requires Site Admin authority';
end;

-- And the value is readable by any signed-in user, because every club's board
-- depends on it.
select count(*) into v_warm from public.platform_scheduling_defaults;
if v_warm = 1 then
  raise notice 'PASS 9 (E): the platform default is readable by an ordinary signed-in user';
else
  raise notice 'FAIL 9 (E): an ordinary user could not read the platform default (% rows)', v_warm;
end if;

-- A NARROW Site Admin is refused too: this value reaches every club on the
-- platform, so it is a Full Site Admin decision, not a club-data one.
perform set_config('request.jwt.claims', json_build_object('sub', v_narrow, 'role','authenticated')::text, true);
begin
  perform public.set_platform_scheduling_defaults(45, 45);
  raise notice 'FAIL 8b (E): a narrow (club_data) Site Admin changed the platform scheduling default';
exception when others then
  raise notice 'PASS 8b (E): a narrow Site Admin cannot change the platform default -- Full Site Admin only';
end;

perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
begin
  perform public.set_platform_scheduling_defaults(20, 20);
  v_blocked := false;
exception when others then v_blocked := true;
end;
if not v_blocked and (select warm_up_minutes from public.platform_scheduling_defaults) = 20 then
  raise notice 'PASS 10 (E): a Site Admin can change the platform default, and it takes effect';
else
  raise notice 'FAIL 10 (E): Site Admin could not change the platform default (blocked=%)', v_blocked;
end if;

-- And an out-of-range value is refused rather than stored.
begin
  perform public.set_platform_scheduling_defaults(7, 15);
  raise notice 'FAIL 11 (E): a 7-minute buffer was accepted outside the 5-minute increment rule';
exception when others then
  raise notice 'PASS 11 (E): the platform default honours the same 0-60 in 5-minute steps a club must';
end;

-- ============ F. THE PLATFORM CHANGE REACHES INHERITING CLUBS ============
--
-- A club that has NOT overridden must follow the platform value, otherwise the
-- default is a one-time copy rather than a living default.

-- Back to the owner role to remove the row: this is test SETUP, not part of
-- what is being asserted, and club_scheduling_policy is RLS-protected against
-- the authenticated identity still in effect from the section above.
perform set_config('role','postgres',true);
delete from public.club_scheduling_policy where club_id = v_club;
select warm_up_minutes, source into v_warm, v_source from public.resolve_club_scheduling_buffers(v_club);
if v_warm = 20 and v_source = 'platform' then
  raise notice 'PASS 12 (F): changing the platform default immediately reaches a club that inherits it';
else
  raise notice 'FAIL 12 (F): inheriting club saw % from % after the platform changed to 20', v_warm, v_source;
end if;

perform set_config('role','postgres',true);

end $$;

rollback;

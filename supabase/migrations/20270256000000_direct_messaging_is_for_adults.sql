-- =====================================================================
-- DIRECT MESSAGING IS FOR ADULTS, NOT FOR STAFF
--
-- 20270254000000 gated direct messaging on holding a staff position. That was
-- the wrong rule. It made the safeguarding boundary a side effect of an
-- unrelated fact -- "coaches have roles, children do not" -- which happened
-- to exclude minors while ALSO excluding every guardian and every adult
-- player, none of whom there was ever a reason to exclude.
--
-- The rule is now stated directly:
--
--   AN ADULT MAY MESSAGE AN ADULT.  A person under 18 may message nobody,
--   and nobody may message them, through this path.
--
-- So coach<->guardian, staff<->guardian, guardian<->guardian, adult
-- player<->coach and adult player<->adult player all become ordinary
-- messaging, and the safeguarding line stops depending on whether somebody
-- happens to hold a permission.
--
-- WHERE AGE COMES FROM, AND WHY NOT A NEW CALCULATION
--
-- internal.resolve_player_chronological_age(dob) already answers "is this
-- person a minor", is IMMUTABLE, and is the predicate the rest of the
-- product uses. It keys on a DATE OF BIRTH rather than on a player id, which
-- is exactly what makes it reusable for an account holder. It is reused
-- verbatim. There is deliberately no second age arithmetic in this file: a
-- competing "< 18" written here is how two answers to one question start
-- drifting apart, and the one that decides whether an adult may message a
-- child is not the one to get wrong.
--
-- THE HARD PART IS AN UNKNOWN AGE, so it is stated rather than defaulted.
-- Every profile in this database has a NULL date of birth; the authoritative
-- ages live on linked player records. So:
--
--   linked to a player who is a minor      -> NOT an adult. Refused.
--   a known date of birth anywhere         -> the canonical predicate decides.
--   no age information at all              -> treated as an adult.
--
-- That last line is the one that deserves challenge, and it is a product
-- decision rather than a technical one. It is safe in Ovalball's data model
-- because children do not self-register: a child exists as a players row
-- created by a guardian or a club, and a child with their own login is linked
-- to that row. An account with no player link and no date of birth is an
-- adult who signed up. If that assumption ever stops holding, THIS is the
-- line to change, and it is isolated here for that reason.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. IS THIS ACCOUNT AN ADULT?
-- ---------------------------------------------------------------------
create or replace function internal.is_adult_messaging_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    p_user_id is not null
    -- ANY linked player who is a minor disqualifies the account. Checked
    -- first and independently: a child with their own login is exactly this
    -- shape, and no later clause may talk them back into being an adult.
    and not exists (
      select 1
      from public.players pl
      cross join lateral internal.resolve_player_chronological_age(pl.date_of_birth) a
      where pl.user_id = p_user_id
        and pl.date_of_birth is not null
        and a.is_minor
    )
    -- A date of birth recorded against the ACCOUNT is equally authoritative.
    and not exists (
      select 1
      from public.profiles pr
      cross join lateral internal.resolve_player_chronological_age(pr.date_of_birth) a
      where pr.id = p_user_id
        and pr.date_of_birth is not null
        and a.is_minor
    );
$$;

comment on function internal.is_adult_messaging_user(uuid) is
  'Is this account held by an adult, for direct-messaging purposes? Age comes from internal.resolve_player_chronological_age -- the one canonical predicate -- applied to a linked player record or to the profile. An account linked to an under-18 player is never an adult, whatever roles it holds.';

revoke all on function internal.is_adult_messaging_user(uuid) from public, anon;
grant execute on function internal.is_adult_messaging_user(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. SITE IS A CEILING, CLUB IS A NARROWING
-- ---------------------------------------------------------------------
-- get_effective_message_policy resolves most features as
-- coalesce(club, site) -- a club override REPLACES the platform value. For
-- direct messaging that is the wrong shape, because it would let a club turn
-- something back ON that Ovalball had switched OFF.
--
-- So direct messaging is resolved as a CONJUNCTION instead: site AND club.
-- A club may make it more restrictive and can never make it less. This is a
-- deliberately different rule from the other flags, and it lives in its own
-- function so that difference is visible rather than buried in a coalesce.
create or replace function internal.direct_messaging_allowed_for_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    -- THE MASTER SWITCH. No club row is consulted if this is false.
    coalesce((select allow_direct_messaging from public.message_policies where club_id is null), true)
    and coalesce(
      (select allow_direct_messaging from public.message_policies
       where p_club_id is not null and club_id = p_club_id),
      -- A club with no opinion inherits "allowed"; the site switch above has
      -- already had its say.
      true
    );
$$;

comment on function internal.direct_messaging_allowed_for_club(uuid) is
  'Whether direct messaging is permitted for a club: the site setting AND the club setting. Unlike the other message-policy features this is a conjunction, not an override -- a club may restrict direct messaging further, and can never re-enable it once Ovalball has switched it off.';

revoke all on function internal.direct_messaging_allowed_for_club(uuid) from public, anon;
grant execute on function internal.direct_messaging_allowed_for_club(uuid) to authenticated;

-- BOTH SIDES' CLUBS MUST PERMIT IT. Two people in different clubs are
-- governed by both, and the restrictive one wins: a club that has switched
-- direct messaging off has switched it off for its own people, including
-- when the person on the other end belongs to a club that has not.
create or replace function internal.direct_messaging_allowed_for_pair(
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    coalesce((select allow_direct_messaging from public.message_policies where club_id is null), true)
    -- No club of either person may have it switched off. Expressed as "there
    -- exists no objecting club" rather than "every club agrees", so a person
    -- who belongs to no club is not accidentally excluded.
    and not exists (
      select 1
      from public.club_memberships cm
      join public.message_policies mp on mp.club_id = cm.club_id
      where cm.user_id in (p_user_a, p_user_b)
        and cm.status = 'active'
        and mp.allow_direct_messaging is false
    );
$$;

comment on function internal.direct_messaging_allowed_for_pair(uuid, uuid) is
  'Whether direct messaging is permitted between these two people once every club either of them belongs to has had its say. The site switch is a ceiling; any club that has switched direct messaging off blocks the pair, including across clubs.';

revoke all on function internal.direct_messaging_allowed_for_pair(uuid, uuid) from public, anon;
grant execute on function internal.direct_messaging_allowed_for_pair(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. THE REVISED AUTHORITY
-- ---------------------------------------------------------------------
-- One expression, consulted by discovery, by thread creation, by every send
-- and by RLS. The staff gate is gone; the age gate replaces it.
create or replace function internal.may_direct_message(p_other_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_other_user_id is null or p_other_user_id = v_me then
    return false;
  end if;

  -- THE SAFEGUARDING BOUNDARY, FIRST AND UNCONDITIONAL.
  -- Nothing below can reach past this: not a shared team, not a shared club,
  -- not a fixture, not an existing thread, not being an administrator. A
  -- person under 18 is not reachable here and cannot reach out here, and the
  -- safeguarded team, group and announcement channels remain where that
  -- communication belongs.
  if not internal.is_adult_messaging_user(v_me)
     or not internal.is_adult_messaging_user(p_other_user_id) then
    return false;
  end if;

  -- A BLOCK IS ABSOLUTE, in both directions, and no policy or relationship
  -- overrides it.
  if internal.is_personally_blocked(v_me, p_other_user_id)
     or internal.is_personally_blocked(p_other_user_id, v_me) then
    return false;
  end if;

  -- SITE, THEN EVERY RELEVANT CLUB.
  if not internal.direct_messaging_allowed_for_pair(v_me, p_other_user_id) then
    return false;
  end if;

  -- AUTHORITY SATISFIED. What remains is DISCOVERY: whether these two people
  -- are connected by something Ovalball actually knows about. Kept separate
  -- on purpose -- "may they" and "can they find each other" are different
  -- questions, and conflating them is how a product grows a global directory.

  -- An existing thread is its own relationship: two people already talking
  -- do not stop being connected because a fixture aged out.
  if exists (
    select 1 from public.direct_conversations d
    where d.user_a = least(v_me, p_other_user_id) and d.user_b = greatest(v_me, p_other_user_id)
  ) then
    return true;
  end if;

  -- Same club. Any active membership on both sides -- this is what makes
  -- coach<->guardian and guardian<->guardian ordinary rather than special.
  if exists (
    select 1
    from public.club_memberships a
    join public.club_memberships b on b.club_id = a.club_id
    where a.user_id = v_me and a.status = 'active'
      and b.user_id = p_other_user_id and b.status = 'active'
  ) then
    return true;
  end if;

  -- A guardian is connected to their child's club even where no club
  -- membership row exists for them: their child plays there.
  if exists (
    select 1
    from public.guardians g
    join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
    join public.teams t on t.id = ptm.team_id
    join public.club_memberships cm on cm.club_id = t.club_id and cm.status = 'active'
    where g.status = 'active'
      and (
        (g.guardian_user_id = v_me and cm.user_id = p_other_user_id)
        or (g.guardian_user_id = p_other_user_id and cm.user_id = v_me)
      )
  ) then
    return true;
  end if;

  -- Same team staff, even across clubs.
  if exists (
    select 1
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = v_me and ca.status = 'active'
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.user_id = p_other_user_id and cb.status = 'active'
  ) then
    return true;
  end if;

  -- Opposite sides of a live fixture. The 60-day window is unchanged from
  -- 20270254000000 and is still a product decision rather than a necessity.
  if exists (
    select 1
    from public.fixtures f
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and (
        (internal.staffs_team(v_me, f.owning_team_id) and internal.staffs_team(p_other_user_id, f.opponent_team_id))
        or
        (internal.staffs_team(v_me, f.opponent_team_id) and internal.staffs_team(p_other_user_id, f.owning_team_id))
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function internal.may_direct_message(uuid) is
  'May the caller direct message this person? Both must be adults, neither may have blocked the other, the site and every relevant club must permit it, and Ovalball must already know of a relationship between them. Age is the safeguarding boundary and is checked before anything else -- no role, club, team, fixture or administrator status reaches past it.';

-- ---------------------------------------------------------------------
-- 4. DISCOVERY FOLLOWS THE SAME RULE
-- ---------------------------------------------------------------------
-- Guardians join the candidate list through their child's club, which is the
-- relationship that makes coach <-> guardian a normal thing to offer.
create or replace function public.my_direct_message_candidates()
returns table (
  user_id uuid,
  display_name text,
  context_label text,
  context_detail text
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with me as (select auth.uid() as id),
  club_mates as (
    select distinct b.user_id, 'Your club'::text as label, d.name as detail
    from public.club_memberships a
    join public.club_memberships b on b.club_id = a.club_id and b.status = 'active'
    join public.clubs c on c.id = a.club_id
    join public.club_directory d on d.id = c.directory_id
    where a.user_id = (select id from me) and a.status = 'active'
  ),
  team_mates as (
    select distinct cb.user_id, 'Your team'::text, t.display_name
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = (select id from me) and ca.status = 'active'
    join public.teams t on t.id = ta.team_id
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.status = 'active'
  ),
  -- THE GUARDIAN BRIDGE, both ways: the staff at my child's club, and the
  -- guardians of the children at a club I am part of.
  guardian_side as (
    select distinct cm.user_id, 'Your child''s club'::text, d.name
    from public.guardians g
    join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
    join public.teams t on t.id = ptm.team_id
    join public.clubs c on c.id = t.club_id
    join public.club_directory d on d.id = c.directory_id
    join public.club_memberships cm on cm.club_id = t.club_id and cm.status = 'active'
    where g.guardian_user_id = (select id from me) and g.status = 'active'
  ),
  staff_side as (
    select distinct g.guardian_user_id, 'Guardian at your club'::text, d.name
    from public.club_memberships mine
    join public.teams t on t.club_id = mine.club_id
    join public.clubs c on c.id = t.club_id
    join public.club_directory d on d.id = c.directory_id
    join public.player_team_memberships ptm on ptm.team_id = t.id and ptm.status = 'active'
    join public.guardians g on g.player_id = ptm.player_id and g.status = 'active'
    where mine.user_id = (select id from me) and mine.status = 'active'
  ),
  fixture_contacts as (
    select distinct cm.user_id, 'Fixture contact'::text, opp.display_name
    from public.fixtures f
    join public.teams mine on mine.id in (f.owning_team_id, f.opponent_team_id)
    join public.teams opp on opp.id in (f.owning_team_id, f.opponent_team_id) and opp.id <> mine.id
    join public.club_memberships cm on cm.club_id = opp.club_id and cm.status = 'active'
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and internal.staffs_team((select id from me), mine.id)
      and internal.staffs_team(cm.user_id, opp.id)
  ),
  everyone as (
    select * from club_mates
    union all select * from team_mates
    union all select * from guardian_side
    union all select * from staff_side
    union all select * from fixture_contacts
  ),
  ranked as (
    select e.user_id, e.label, e.detail,
           row_number() over (
             partition by e.user_id
             order by case e.label
               when 'Your team' then 1
               when 'Your club' then 2
               when 'Your child''s club' then 3
               when 'Guardian at your club' then 4
               else 5 end
           ) as rn
    from everyone e
  )
  select r.user_id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
         r.label,
         r.detail
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rn = 1
    -- THE SAME AUTHORITY THE SEND PATH APPLIES. This is what removes minors,
    -- blocked pairs and policy-disabled pairs from discovery without the list
    -- ever saying which of those it was.
    and internal.may_direct_message(r.user_id)
  order by 2;
$$;

revoke all on function public.my_direct_message_candidates() from public, anon;
grant execute on function public.my_direct_message_candidates() to authenticated;

-- The staff gate is retired. Left defined but no longer consulted by any
-- direct-messaging path; dropping it would break nothing, but naming it here
-- records deliberately that it is no longer the rule.
comment on function internal.is_messaging_staff(uuid) is
  'RETIRED as a direct-messaging gate by 20270256000000. Direct messaging is now adult-to-adult; holding a staff position is not a prerequisite. Retained only so older callers do not break.';

-- ---------------------------------------------------------------------
-- 5. WHICH CLUBS IS A PERSON ACTUALLY PART OF?
-- ---------------------------------------------------------------------
-- The first version of the adult rule still discovered people through
-- club_memberships alone, and that quietly reproduced the staff gate it was
-- meant to remove: an adult PLAYER has no membership row, and neither does a
-- GUARDIAN. Both belong to a club all the same -- the player because they
-- play for one of its teams, the guardian because their child does -- and
-- both are exactly the people the revised rule exists to include.
--
-- So club connection is resolved from all three routes at once, in one place,
-- and every "same club" question asks this rather than joining memberships
-- directly.
create or replace function internal.messaging_club_ids(p_user_id uuid)
returns table (club_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  -- Staff and ordinary members.
  select cm.club_id
  from public.club_memberships cm
  where cm.user_id = p_user_id and cm.status = 'active'

  union

  -- An adult player, through the teams they play for.
  select t.club_id
  from public.players pl
  join public.player_team_memberships ptm on ptm.player_id = pl.id and ptm.status = 'active'
  join public.teams t on t.id = ptm.team_id
  where pl.user_id = p_user_id

  union

  -- A guardian, through their child's teams.
  select t.club_id
  from public.guardians g
  join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
  join public.teams t on t.id = ptm.team_id
  where g.guardian_user_id = p_user_id and g.status = 'active';
$$;

comment on function internal.messaging_club_ids(uuid) is
  'Every club a person belongs to for messaging purposes: as a member or staff, as a player on one of its teams, or as the guardian of a child on one of its teams. Membership rows alone would exclude adult players and guardians, who are precisely the people adult-to-adult messaging is for.';

revoke all on function internal.messaging_club_ids(uuid) from public, anon;
grant execute on function internal.messaging_club_ids(uuid) to authenticated;

-- The pair policy must read the same set, or a club could switch direct
-- messaging off and still not govern its own guardians and adult players.
create or replace function internal.direct_messaging_allowed_for_pair(
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    coalesce((select allow_direct_messaging from public.message_policies where club_id is null), true)
    and not exists (
      select 1
      from (
        select club_id from internal.messaging_club_ids(p_user_a)
        union
        select club_id from internal.messaging_club_ids(p_user_b)
      ) c
      join public.message_policies mp on mp.club_id = c.club_id
      where mp.allow_direct_messaging is false
    );
$$;

revoke all on function internal.direct_messaging_allowed_for_pair(uuid, uuid) from public, anon;
grant execute on function internal.direct_messaging_allowed_for_pair(uuid, uuid) to authenticated;

-- And "same club" in the authority becomes the intersection of those sets,
-- which is what makes guardian<->guardian and adult player<->coach ordinary.
create or replace function internal.may_direct_message(p_other_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_other_user_id is null or p_other_user_id = v_me then
    return false;
  end if;

  -- THE SAFEGUARDING BOUNDARY, FIRST AND UNCONDITIONAL. Nothing below can
  -- reach past this: not a shared club, not a guardian relationship, not a
  -- fixture, not an existing thread, not administrator status.
  if not internal.is_adult_messaging_user(v_me)
     or not internal.is_adult_messaging_user(p_other_user_id) then
    return false;
  end if;

  -- A BLOCK IS ABSOLUTE, in both directions.
  if internal.is_personally_blocked(v_me, p_other_user_id)
     or internal.is_personally_blocked(p_other_user_id, v_me) then
    return false;
  end if;

  -- SITE, THEN EVERY CLUB EITHER PERSON BELONGS TO.
  if not internal.direct_messaging_allowed_for_pair(v_me, p_other_user_id) then
    return false;
  end if;

  -- DISCOVERY: is there a relationship Ovalball actually knows about?

  -- Already talking.
  if exists (
    select 1 from public.direct_conversations d
    where d.user_a = least(v_me, p_other_user_id) and d.user_b = greatest(v_me, p_other_user_id)
  ) then
    return true;
  end if;

  -- SAME CLUB, by any of the three routes. One clause now covers
  -- coach<->coach, coach<->guardian, guardian<->guardian,
  -- coach<->adult player and adult player<->adult player.
  if exists (
    select 1
    from internal.messaging_club_ids(v_me) a
    join internal.messaging_club_ids(p_other_user_id) b on b.club_id = a.club_id
  ) then
    return true;
  end if;

  -- Same team staff, even across clubs.
  if exists (
    select 1
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = v_me and ca.status = 'active'
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.user_id = p_other_user_id and cb.status = 'active'
  ) then
    return true;
  end if;

  -- Opposite sides of a live fixture. The 60-day window is a product
  -- decision, unchanged from 20270254000000.
  if exists (
    select 1
    from public.fixtures f
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and (
        (internal.staffs_team(v_me, f.owning_team_id) and internal.staffs_team(p_other_user_id, f.opponent_team_id))
        or
        (internal.staffs_team(v_me, f.opponent_team_id) and internal.staffs_team(p_other_user_id, f.owning_team_id))
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

-- Discovery reads the same club set, so the list and the rule agree.
create or replace function public.my_direct_message_candidates()
returns table (
  user_id uuid,
  display_name text,
  context_label text,
  context_detail text
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with me as (select auth.uid() as id),
  my_clubs as (select club_id from internal.messaging_club_ids((select id from me))),
  club_people as (
    -- Everybody connected to one of my clubs, by any of the three routes.
    select distinct x.user_id, 'Your club'::text as label, d.name as detail
    from my_clubs mc
    join public.clubs c on c.id = mc.club_id
    join public.club_directory d on d.id = c.directory_id
    cross join lateral (
      select cm.user_id from public.club_memberships cm
      where cm.club_id = mc.club_id and cm.status = 'active'
      union
      select pl.user_id from public.players pl
      join public.player_team_memberships ptm on ptm.player_id = pl.id and ptm.status = 'active'
      join public.teams t on t.id = ptm.team_id
      where t.club_id = mc.club_id and pl.user_id is not null
      union
      select g.guardian_user_id from public.guardians g
      join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
      join public.teams t on t.id = ptm.team_id
      where t.club_id = mc.club_id and g.status = 'active'
    ) x
  ),
  team_mates as (
    select distinct cb.user_id, 'Your team'::text as label, t.display_name as detail
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = (select id from me) and ca.status = 'active'
    join public.teams t on t.id = ta.team_id
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.status = 'active'
  ),
  fixture_contacts as (
    select distinct cm.user_id, 'Fixture contact'::text as label, opp.display_name as detail
    from public.fixtures f
    join public.teams mine on mine.id in (f.owning_team_id, f.opponent_team_id)
    join public.teams opp on opp.id in (f.owning_team_id, f.opponent_team_id) and opp.id <> mine.id
    join public.club_memberships cm on cm.club_id = opp.club_id and cm.status = 'active'
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and internal.staffs_team((select id from me), mine.id)
      and internal.staffs_team(cm.user_id, opp.id)
  ),
  everyone as (
    select * from team_mates
    union all select * from club_people
    union all select * from fixture_contacts
  ),
  ranked as (
    select e.user_id, e.label, e.detail,
           row_number() over (
             partition by e.user_id
             order by case e.label when 'Your team' then 1 when 'Your club' then 2 else 3 end
           ) as rn
    from everyone e
  )
  select r.user_id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
         r.label,
         r.detail
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rn = 1
    -- THE SAME AUTHORITY THE SEND PATH APPLIES: this removes minors, blocked
    -- pairs and policy-disabled pairs without the list saying which.
    and internal.may_direct_message(r.user_id)
  order by 2;
$$;

revoke all on function public.my_direct_message_candidates() from public, anon;
grant execute on function public.my_direct_message_candidates() to authenticated;

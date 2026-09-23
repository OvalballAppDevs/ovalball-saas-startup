-- ===========================================================================
-- A CONTACT SAYS WHICH CLUB THEY ARE FROM
-- ===========================================================================
--
-- `my_direct_message_candidates` groups the people you may message and labels
-- each with the reason they are there: "Your team", "Your club", "Fixture
-- contact". Two of those three then said WHICH team, and never which club.
--
-- For "Your club" that was fine, because the detail WAS the club. For the other
-- two it was not:
--
--     Gareth Hollins
--     Under 12 Boys
--
-- Under 12 Boys of WHICH club? A fixture contact is by definition somebody from
-- the other side, and a club that plays three different Under 12 sides across a
-- season gets three identical-looking rows. The owner put it plainly: "If there
-- are multiple clubs in there then that would get confusing."
--
-- WHY A COLUMN RATHER THAN A LONGER STRING. The club could have been appended to
-- `context_detail` with a separator, and both clients would have rendered it. But
-- the separator would then be the database's decision, a client wanting the club
-- on its own line would have to split the string back apart, and SEARCH would be
-- matching against a punctuation-joined label rather than against a club name. So
-- the club is its own column and each client composes.
--
-- The club is the CLUB DIRECTORY's name -- the canonical identity every other
-- surface shows -- never `clubs.slug` and never a team's display name.
--
-- WHAT IS NOT CHANGED. The authority. The candidate set is exactly what it was:
-- `internal.may_direct_message` still decides, still last, and still without the
-- list saying why anybody is absent. This adds a word to a row that was already
-- allowed to exist.
-- ===========================================================================

drop function if exists public.my_direct_message_candidates();

create function public.my_direct_message_candidates()
returns table (user_id uuid, display_name text, context_label text, context_detail text, context_club text)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with me as (select auth.uid() as id),
  my_clubs as (select club_id from internal.messaging_club_ids((select id from me))),
  club_people as (
    -- Everybody connected to one of my clubs, by any of the three routes.
    select distinct x.user_id, 'Your club'::text as label, d.name as detail, d.name as club
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
    select distinct cb.user_id, 'Your team'::text as label, t.display_name as detail, d.name as club
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = (select id from me) and ca.status = 'active'
    join public.teams t on t.id = ta.team_id
    join public.clubs c on c.id = t.club_id
    join public.club_directory d on d.id = c.directory_id
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.status = 'active'
  ),
  fixture_contacts as (
    select distinct cm.user_id, 'Fixture contact'::text as label, opp.display_name as detail, d.name as club
    from public.fixtures f
    join public.teams mine on mine.id in (f.owning_team_id, f.opponent_team_id)
    join public.teams opp on opp.id in (f.owning_team_id, f.opponent_team_id) and opp.id <> mine.id
    join public.clubs c on c.id = opp.club_id
    join public.club_directory d on d.id = c.directory_id
    join public.club_memberships cm on cm.club_id = opp.club_id and cm.status = 'active'
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and internal.team_messaging_staff((select id from me), mine.id)
      and internal.team_messaging_staff(cm.user_id, opp.id)
  ),
  everyone as (
    select * from team_mates
    union all select * from club_people
    union all select * from fixture_contacts
  ),
  ranked as (
    select e.user_id, e.label, e.detail, e.club,
           row_number() over (
             partition by e.user_id
             order by case e.label when 'Your team' then 1 when 'Your club' then 2 else 3 end
           ) as rn
    from everyone e
  )
  select r.user_id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
         r.label,
         r.detail,
         r.club
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rn = 1
    -- THE SAME AUTHORITY THE SEND PATH APPLIES: this removes minors, blocked
    -- pairs and policy-disabled pairs without the list saying which.
    and internal.may_direct_message(r.user_id)
  order by 2;
$$;

comment on function public.my_direct_message_candidates is
  'The people this caller may start a direct conversation with, each with the reason they are there (Your team / Your club / Fixture contact), the team or club that reason refers to, and the CLUB they belong to. The club is the Club Directory name and was added in M6 because a fixture contact labelled only "Under 12 Boys" does not say whose Under 12 Boys. Authority is internal.may_direct_message, unchanged.';

revoke all on function public.my_direct_message_candidates() from public;
grant execute on function public.my_direct_message_candidates() to authenticated, service_role;

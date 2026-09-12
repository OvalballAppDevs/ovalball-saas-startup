-- =====================================================================
-- A FIXTURE IS A REASON TO TALK
--
-- internal.may_direct_message already treats "opposite sides of a live
-- fixture" as a relationship. What has been missing is the route a person
-- would actually take: standing on the fixture, wanting to tell the other
-- side the pitch has flooded, and having nowhere to click.
--
-- This resolves the people on the other side of ONE fixture whom the caller
-- may legitimately message. It is deliberately thin, because all the hard
-- questions are already answered elsewhere:
--
--   WHO IS ON THE OTHER SIDE    internal.staffs_team, the same predicate the
--                               fixture clause of may_direct_message uses.
--   MAY I MESSAGE THEM          internal.may_direct_message, unchanged. Age,
--                               blocks, site policy and every relevant club
--                               policy are all inside it.
--
-- So this function cannot admit anybody the send path would refuse, and it
-- cannot be made more permissive without changing the authority it calls.
--
-- WHY ONLY AN INTERNAL OPPONENT
--
-- Most Ovalball fixtures name their opponent from the Club Directory -- a
-- name, not an organisation with accounts. There is nobody to message, so the
-- action must not appear. Requiring opponent_team_id is what makes
-- "Message opposition" mean something wherever it is shown, rather than
-- appearing on every fixture and disappointing most of them.
--
-- AND IT IS PERSON-TO-PERSON. This returns people, not a team conversation:
-- the product decision is that contacting the opposition means contacting a
-- named human who can answer, not posting into a group nobody owns.
-- =====================================================================

create or replace function public.fixture_opposition_contacts(p_fixture_id uuid)
returns table (
  user_id uuid,
  display_name text,
  team_label text,
  club_label text
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  f public.fixtures;
  v_my_team uuid;
  v_their_team uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select * into f from public.fixtures where id = p_fixture_id;
  if not found or f.opponent_team_id is null then
    -- No internal opponent: nobody to talk to, and the caller is told that by
    -- getting nothing rather than by an error.
    return;
  end if;

  -- WHICH SIDE AM I ON? Answered from canonical team staffing, never from
  -- the fixture's own text fields.
  if internal.staffs_team(auth.uid(), f.owning_team_id) then
    v_my_team := f.owning_team_id;
    v_their_team := f.opponent_team_id;
  elsif internal.staffs_team(auth.uid(), f.opponent_team_id) then
    v_my_team := f.opponent_team_id;
    v_their_team := f.owning_team_id;
  else
    -- Not involved in this fixture. Nothing, rather than an error: a fixture
    -- id somebody is not part of should not confirm anything about it.
    return;
  end if;

  return query
  select
    cm.user_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
    t.display_name,
    d.name
  from public.club_memberships cm
  join public.teams t on t.id = v_their_team
  join public.clubs c on c.id = t.club_id
  join public.club_directory d on d.id = c.directory_id
  join public.profiles p on p.id = cm.user_id
  where cm.club_id = t.club_id
    and cm.status = 'active'
    -- They must actually staff the opposing team, not merely belong to its
    -- club: a fixture is a reason to contact the people running that team,
    -- not everybody the club has ever registered.
    and internal.staffs_team(cm.user_id, v_their_team)
    -- AND THE ONE AUTHORITY. Adults only, policy-permitted on both sides,
    -- never across a block. This is what stops the fixture becoming a way
    -- around any of them.
    and internal.may_direct_message(cm.user_id)
  order by 2;
end;
$$;

comment on function public.fixture_opposition_contacts(uuid) is
  'The people on the other side of this fixture whom the caller may direct message. Returns nothing when the opponent is a Club Directory name rather than an Ovalball team, when the caller is not involved in the fixture, or when direct messaging authority does not permit it. Filtered by internal.may_direct_message, so it can never offer somebody the send path would refuse.';

revoke all on function public.fixture_opposition_contacts(uuid) from public, anon;
grant execute on function public.fixture_opposition_contacts(uuid) to authenticated;

-- Slice 4D (competitions and tournaments) -- part 1: move the competition and tournament
-- authority gates onto the canonical capability decision (Phase 2 AA.3 row 4d, design J.8
-- lines 482-491).
--
-- AA.3 row 4d retires two things: "`can_organise_competition` role checks" and
-- "`calendar.manage` tournament use". Both are here. What is NOT here is every other caller
-- of `calendar.manage`: club events keep it until 4e owns them, because a club event is a
-- calendar question and this slice owns competitions and tournaments. A helper is retired by
-- the slice that owns the meaning of the call site.
--
-- The keys, their scopes and their bundles are already in the catalogue exactly as J.8
-- specifies them -- Slice 3 seeded them and they are live in production. This slice does not
-- add or alter a capability; it makes the gates ask the catalogue instead of asking role
-- strings and a deprecated adapter.
--
-- EXPAND STEP. Every function below is replaced in place and every caller is a SECURITY
-- DEFINER RPC or an RLS policy that already calls it, so this migration changes answers
-- without changing shapes. It is safe to apply while the current application is serving:
-- there is no privilege change, no signature change and no application dependency.

-- 1. Competition organiser ------------------------------------------------------------------
-- Legacy asked `can_bulk_plan_fixtures(organiser_club)`, which is 4c's Planner/Import gate.
-- Organising a competition is not bulk fixture planning; J.8 line 484 names the key.
create or replace function internal.can_organise_competition(p_competition_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.competitions c
    where c.id = p_competition_id
      and (
        internal.has_site_capability('site.competitions.manage')
        or (c.organiser_club_id is not null
            and internal.can('competition.edition.manage', 'club', c.organiser_club_id, null, null))
      )
  );
$$;

comment on function internal.can_organise_competition(uuid) is
  'Slice 4D: competition.edition.manage at the organiser club, or the explicit site master '
  'site.competitions.manage. Replaces the can_bulk_plan_fixtures borrow (J.8 line 484).';

-- 2. Edition organiser ----------------------------------------------------------------------
-- Unchanged in shape: an edition is organised by whoever organises its competition. It becomes
-- canonical because the function above did.
create or replace function internal.can_organise_edition(p_edition_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.competition_editions e
    where e.id = p_edition_id and internal.can_organise_competition(e.competition_id)
  );
$$;

-- 3. Answering a competition match ----------------------------------------------------------
-- Legacy read raw role strings twice over: is_club_fixture_administrator() matched
-- ('CLUB_ADMIN','FIXTURE_SECRETARY') on the membership, and a raw team_permissions read matched
-- ('team_admin','coach','manager'). J.8 line 488 gives competition.match.respond to CA and FS at
-- club scope and TM at team scope, and it inherits. A COACH IS NOT ON THAT LIST, and that is the
-- intended change: answering a competition match commits the club to play it, which is the same
-- boundary Slice 4C drew when a Coach kept the right to raise a fixture request and lost the
-- right to answer one.
create or replace function internal.can_answer_competition_match(p_club_id uuid, p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.can('competition.match.respond', 'club', p_club_id, null, null)
    or (p_team_id is not null
        and internal.can('competition.match.respond', 'team', p_club_id, p_team_id, null))
    or internal.has_site_capability('site.support.act_in_club');
$$;

comment on function internal.can_answer_competition_match(uuid, uuid) is
  'Slice 4D: competition.match.respond at the club or the team (J.8 line 488). A Coach may not '
  'answer -- answering commits the club to play the match.';

-- 4. Managing a tournament, the OCCASION ----------------------------------------------------
-- Three legacy things go: the bare internal.is_site_admin() bypass, the deprecated
-- `calendar.manage` adapter, and the "team-scope authority over EVERY entered team" branch.
--
-- That last one is an intended change and it is worth saying why it is not a loss. The branch
-- was written to express "a U12 manager does not get the parent occasion just because U12 is
-- going" -- but when U12 is the ONLY team entered, "every entered team" is satisfied by one
-- team and the U12 manager got the whole occasion after all. The rule contradicted its own
-- stated intent in the single-entry case. J.8 line 490 settles it: the occasion is the club's
-- (CL scope, CA and FS), and the manager keeps their own entry below.
create or replace function internal.can_manage_tournament(p_tournament_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament_id
      and (
        internal.has_site_capability('site.support.act_in_club')

        -- The host club's own occasion.
        or (t.host_club_id is not null
            and internal.can('tournament.tournament.manage', 'club', t.host_club_id, null, null))

        -- Or a club that entered a team, for the ordinary case of a club managing its own trip
        -- to somebody else's festival.
        or exists (
          select 1 from public.tournament_team_entries e
          where e.tournament_id = t.id
            and internal.can('tournament.tournament.manage', 'club', e.club_id, null, null)
        )
      )
  );
$$;

comment on function internal.can_manage_tournament(uuid) is
  'Slice 4D: tournament.tournament.manage at the host club or at a club that entered a team, or '
  'the explicit site master site.support.act_in_club (J.8 line 490). The occasion is club-level; '
  'a team manages its own entry, not the day.';

-- 5. Managing a tournament ENTRY ------------------------------------------------------------
-- J.8 defines tournament.tournament.view (CL, TE) and tournament.tournament.manage (CL). It says
-- nothing about entries, so the governing authority for the team branch is the product invariant
-- that created the entry/occasion split in 20270217000000: "THIS team only. The whole point of
-- the split: a U12 admin schedules U12's day and cannot touch U13's." That invariant is live --
-- measured, not assumed -- and this slice preserves it rather than silently dropping it.
--
-- The team-scope question is "may this person manage this team's schedule", which is a calendar
-- question whose canonical key 4e owns (calendar.event.manage, {club,team}, inherits). Asking
-- another slice's key for another slice's question is the same boundary Slice 4B drew when its
-- roster policies kept asking 4a's family helpers. What AA.3 requires of 4d is satisfied: the
-- deprecated `calendar.manage` string and the has_capability adapter are both gone.
--
-- The host branch moves off can_manage_club_fixtures (4c's helper) onto the tournament key: the
-- host club manages entries at its own occasion because it hosts, not because it runs fixtures.
create or replace function internal.can_manage_tournament_entry(p_entry_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_team_entries e
    where e.id = p_entry_id
      and (
        internal.has_site_capability('site.support.act_in_club')
        or internal.can('tournament.tournament.manage', 'club', e.club_id, null, null)
        -- THIS team only. A U12 manager schedules U12's day and cannot touch U13's.
        or internal.can('calendar.event.manage', 'team', e.club_id, e.team_id, null)
        or exists (
          select 1 from public.tournaments t
          where t.id = e.tournament_id
            and t.host_club_id is not null
            and internal.can('tournament.tournament.manage', 'club', t.host_club_id, null, null)
        )
      )
  );
$$;

comment on function internal.can_manage_tournament_entry(uuid) is
  'Slice 4D: the entering club''s tournament.tournament.manage, that team''s calendar.event.manage, '
  'the host club''s tournament.tournament.manage, or site.support.act_in_club. The team branch '
  'preserves the entry/occasion split introduced in 20270217000000.';

-- 6. The one remaining raw-role read: issuing competition matches ----------------------------
-- `issue_competition_matches` asked internal.is_club_fixture_administrator(club) four times to
-- decide whether the organiser had, in effect, already answered on that participating club's
-- own behalf. That helper matched the role strings 'CLUB_ADMIN' and 'FIXTURE_SECRETARY'
-- directly. The canonical form of the same question is competition.match.respond at that club.
--
-- The site master equivalent is deliberately NOT asked here. Everywhere else in 4D a site
-- capability is an explicit, legitimate answer; here the question is "has somebody at THAT club
-- agreed", and letting site support silently pre-confirm a match for a club nobody at that club
-- has spoken for would invent consent. The function's own comment already said so about Site
-- Admin, and the canonical rewrite keeps that true.
create or replace function public.issue_competition_matches(p_edition_id uuid, p_match_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m public.competition_matches;
  p public.competition_participants;
  v_issued integer := 0;
  v_waiting integer := 0;
  v_label text;
  v_verification uuid;
begin
  perform internal.require_edition_organiser(p_edition_id);

  for m in
    select * from public.competition_matches
    where edition_id = p_edition_id
      and (p_match_ids is null or id = any (p_match_ids))
      and status in ('draft', 'scheduled', 'issued', 'change_requested', 'confirmed')
    order by round_number nulls last, bracket_slot nulls last
    for update
  loop
    if m.status = 'draft' then
      update public.competition_matches set status = 'scheduled', updated_by = auth.uid(), updated_at = now() where id = m.id;
    end if;

    for p in select * from public.competition_participants where id in (m.home_participant_id, m.away_participant_id) loop
      continue when p.team_id is null;
      select id into v_verification from public.competition_match_verifications where match_id = m.id and participant_id = p.id;
      if v_verification is null then
        insert into public.competition_match_verifications (match_id, participant_id, club_id, team_id, status, responded_by, responded_at)
        values (m.id, p.id, p.club_id, p.team_id,
          -- An organiser who holds that club's own competition.match.respond has answered
          -- for it. Anybody else -- a Site Admin included -- has not, which is why the site
          -- master equivalent is deliberately NOT asked here: site.support.act_in_club lets
          -- support act for a club, and pre-confirming a match on a club's behalf without
          -- anyone at that club agreeing is exactly what this must not do.
          case when internal.can('competition.match.respond', 'club', p.club_id, null, null) then 'confirmed' else 'awaiting' end,
          case when internal.can('competition.match.respond', 'club', p.club_id, null, null) then auth.uid() end,
          case when internal.can('competition.match.respond', 'club', p.club_id, null, null) then now() end)
        returning id into v_verification;
      elsif m.status = 'change_requested' then
        update public.competition_match_verifications
        set status = case when internal.can('competition.match.respond', 'club', p.club_id, null, null) then 'confirmed' else 'awaiting' end,
            message = null, proposed_date = null, proposed_kickoff_time = null, proposed_venue_id = null, proposed_pitch_id = null,
            responded_by = null, responded_at = null, updated_at = now()
        where id = v_verification;
      else
        continue;
      end if;

      if (select status from public.competition_match_verifications where id = v_verification) = 'awaiting' then
        v_waiting := v_waiting + 1;
        v_label := internal.competition_match_label(m.id);
        insert into public.notifications (user_id, type, title, body, data)
        select distinct r.user_id, 'competition_match_verification_requested', 'Confirm a competition match',
          format('%s. Confirm it, request a change or decline.', v_label),
          jsonb_build_object('competition_match_id', m.id, 'verification_id', v_verification, 'edition_id', m.edition_id)
        from internal.competition_club_recipients(p.club_id, p.team_id) r
        where r.user_id is distinct from auth.uid();
      end if;
    end loop;

    perform internal.refresh_competition_match_verification(m.id);
    perform internal.project_competition_match(m.id);
    v_issued := v_issued + 1;
  end loop;

  return jsonb_build_object('issued', v_issued, 'awaiting_clubs', v_waiting);
end;
$function$;


-- 7. Retire the now-callerless raw-role helper ----------------------------------------------
-- internal.is_club_fixture_administrator(uuid) matched the membership role strings 'CLUB_ADMIN'
-- and 'FIXTURE_SECRETARY' directly. Its only two callers were the two 4D functions rewritten
-- above, so it now has none: no policy, no function, no application code.
--
-- It is dropped rather than left in place. A zero-caller authority helper is a hazard -- the
-- next person needing "is this person a club's fixture administrator" would find a raw-role
-- answer before they found the canonical one, and raw-role authority is precisely what this
-- programme removes. The same reasoning retired internal.fixture_visible_row in Slice 4C.
drop function if exists internal.is_club_fixture_administrator(uuid);

do $$
begin
  if exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'internal' and pr.proname = 'is_club_fixture_administrator'
  ) then
    raise exception 'internal.is_club_fixture_administrator survived; a caller must still exist.';
  end if;
end $$;

-- =====================================================================
-- THE CLUB AUDIT TIMELINE — Slice 8, AB.5's other half.
--
-- Ovalball has recorded every access decision since Slice 1. A Site Admin can
-- read that record about a person (site_membership_history, site_team_history,
-- site_family_history, site_account_history, all built in 7e). A CLUB cannot
-- read it about itself.
--
-- That asymmetry is the defect. The person who most needs to know that
-- somebody's Coach role was removed on Tuesday, and by whom, is the Club Admin
-- of the club it happened at -- and until now their only options were to ask
-- Ovalball or to notice the consequence.
--
-- WHAT THIS IS NOT. It is not a new log. Nothing is written here. It is a read
-- of public.security_events, which internal.refuse_history_rewrite() already
-- makes append-only, scoped to one club and gated on the capability that
-- governs seeing people's access at that club. A second log would be a second
-- truth, and the audit trail is the one place that can least afford one.
--
-- THE SCOPE COLUMNS ARE WHAT AN EVENT IS. `club_id` on the row, not the event
-- name, decides which club an event belongs to -- the same rule
-- site_membership_history states. An event name is what a thing is called.
-- =====================================================================

create or replace function public.club_access_history(
  p_club_id uuid,
  p_subject_user_id uuid default null,
  p_limit integer default 200
)
returns TABLE(
  at timestamptz,
  event_type text,
  outcome text,
  subject_user_id uuid,
  subject_name text,
  actor_user_id uuid,
  actor_name text,
  team_id uuid,
  team_name text,
  reason text,
  capability_key text,
  role_key text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_club_id is null then
    raise exception 'A club timeline names a club.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Ask for between 1 and 500 entries.' using errcode = '22023';
  end if;

  -- THE BOUNDARY. `people.access.explain` is the capability that governs
  -- seeing WHY a person has the access they have. A timeline of access
  -- decisions is that same question asked about the past, so it is governed by
  -- the same key rather than a new one. Someone who cannot be told why a coach
  -- may cancel a match today has no business reading how that came about.
  -- A SITE ADMIN IS NOT A CLUB MEMBER, and must never have to become one to do
  -- their job. site_membership_history and its neighbours gate on
  -- site.users.view for exactly this reason; a club timeline is the same
  -- question asked club-first, so it admits the same platform authority
  -- without anybody being added to the club to make it work.
  if not (internal.can('people.access.explain', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.users.view')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  select e.occurred_at,
         e.event_type,
         e.outcome,
         e.subject_user_id,
         coalesce(nullif(btrim(concat_ws(' ', sp.first_name, sp.surname)), ''), '(no name recorded)'),
         e.actor_user_id,
         coalesce(nullif(btrim(concat_ws(' ', ap.first_name, ap.surname)), ''), '(no name recorded)'),
         e.team_id,
         t.display_name,
         e.reason,
         -- The human label, not the key. `metadata->>'capability_key'` holds
         -- `venue.pitch_allocation.manage` and `role_key` holds `VOLUNTEER`;
         -- a club reading its own history is owed the words the rest of the
         -- product uses. The catalogues are the source, joined here so the
         -- timeline cannot drift from them, and an unrecognised key falls
         -- back to itself rather than to a blank or a guess.
         coalesce(cap.label, e.metadata->>'capability_key'),
         coalesce(rd.label, e.metadata->>'role_key', e.metadata->>'role')
    from public.security_events e
    left join public.profiles sp on sp.id = e.subject_user_id
    left join public.profiles ap on ap.id = e.actor_user_id
    left join public.teams t on t.id = e.team_id
    left join public.capabilities cap on cap.key = e.metadata->>'capability_key'
    left join public.role_definitions rd on rd.role_key = coalesce(e.metadata->>'role_key', e.metadata->>'role')
   where e.club_id = p_club_id
     and (p_subject_user_id is null or e.subject_user_id = p_subject_user_id)
     -- Access decisions only. This is not the club's general event feed: a
     -- fixture being created is not a change to anybody's authority, and
     -- putting it here would bury the entries that matter.
     and (e.event_type like 'role.%'
       or e.event_type like 'membership.%'
       or e.event_type like 'override.%'
       or e.event_type like 'invitation.%'
       or e.event_type like 'team_access.%'
       or e.event_type like 'player_team.%'
       or e.event_type like 'guardian.%'
       or e.event_type like 'site.role%'
       or e.event_type like 'site.membership%'
       or e.event_type like 'site.team%')
   order by e.occurred_at desc
   limit p_limit;
end;
$$;

revoke all on function public.club_access_history(uuid, uuid, integer) from public;
grant execute on function public.club_access_history(uuid, uuid, integer) to authenticated;

comment on function public.club_access_history(uuid, uuid, integer) is
  'One club''s access history, read from the append-only security_events stream and gated on '
  'people.access.view at that club. Reads only -- there is no second log. Actor and subject are '
  'kept distinct because "who did this" and "who it was done to" are different questions.';

-- ---------------------------------------------------------------------
-- The capability must exist and be club-scoped, or the gate above is a
-- typo that fails open by never matching anything.
-- ---------------------------------------------------------------------
do $guard$
begin
  if not exists (
    select 1 from public.capabilities
    where key = 'people.access.explain' and status = 'ACTIVE' and 'club' = any (valid_scopes)) then
    raise exception 'club_access_history is gated on people.access.explain, which is not an ACTIVE club-scoped capability.';
  end if;

  -- The timeline must never be able to reach another club. Proved by the
  -- predicate rather than asserted: there is exactly one club_id comparison
  -- and it is to the parameter.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'club_access_history'
        and pg_get_functiondef(p.oid) like '%e.club_id = p_club_id%') <> 1 then
    raise exception 'club_access_history no longer scopes on e.club_id = p_club_id.';
  end if;
end;
$guard$;

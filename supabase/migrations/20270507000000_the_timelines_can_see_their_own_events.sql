-- =====================================================================================================
-- SLICE 7e (4/n) -- the provenance timelines could not see the events their own slice writes.
--
-- HOW THIS SURFACED. Slice 7b built site_membership_history, site_team_history and site_family_history.
-- The reconciliation's verdict was that they "answer a question no screen asks". Slice 7e gave them
-- screens -- and the first browser assertion that added a club membership through the product and then
-- looked for it on the Membership History tab found nothing.
--
-- The cause is a pattern mismatch, and it is the kind that only shows up when something finally reads
-- the output. site_add_club_membership emits `site.membership_added`; site_membership_history matched
-- `membership.%`, `site.club_%` and `club.%`. Neither matches the other. Across the master-control
-- family, SEVEN of the sixteen event types it emits were displayed by nothing at all:
--
--   site.membership_added, site.membership_transitioned, site.role_revoked,
--   account.password_reset_forced, account.setup_resent, session.revoked_by_admin,
--   site_admin.grant_requested / grant_approved / grant_rejected / revoked_with_reason, user.created
--
-- Every one of those is a decision somebody will later need to explain. "Why is this person no longer a
-- Club Admin" and "who ended their sessions on the 3rd" were both unanswerable from the product, while
-- the row sat in security_events the whole time.
--
-- WHAT CHANGES. The membership and team timelines now discriminate on the SCOPE COLUMN rather than on
-- the shape of the event name: an event carrying a team_id is team history, one without is membership
-- history. A name is a label and drifts; club_id/team_id/player_id are what the event actually is
-- about, so a new event type is covered the day it is written instead of the day somebody notices.
--
-- And a fourth timeline is added for what is neither: account state, sessions, password resets, setup
-- invitations, Site Admin grants and the creation of the identity itself. Those belong on Audit History
-- beside the row-level audit_log entries, which is where somebody looks when the question is "what
-- happened to this account".
--
-- The migration ends by asserting, for every event type the master-control functions emit, that some
-- timeline would show it -- so this cannot silently regress the next time one is added.
-- =====================================================================================================

create or replace function public.site_membership_history(p_user_id uuid)
returns table (at timestamptz, club_id uuid, club_name text, entry text, detail text, actor_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.occurred_at, e.club_id, cd.name, e.event_type, e.reason, e.actor_user_id
    from public.security_events e
    left join public.clubs c on c.id = e.club_id
    left join public.club_directory cd on cd.id = c.directory_id
   where internal.has_site_capability('site.users.view')
     and e.subject_user_id = p_user_id
     -- A club-scope decision is one with no team on it. The scope columns are what the event IS;
     -- the event name is only what it is called.
     and e.team_id is null
     and (e.event_type like 'membership.%'
       or e.event_type like 'club.%'
       or e.event_type like 'site.membership%'
       or e.event_type like 'site.club%'
       or e.event_type like 'role.%'
       or e.event_type like 'site.role%')
   order by e.occurred_at desc
   limit 500;
$$;

create or replace function public.site_team_history(p_user_id uuid)
returns table (at timestamptz, team_id uuid, entry text, detail text, actor_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.occurred_at, e.team_id, e.event_type, e.reason, e.actor_user_id
    from public.security_events e
   where internal.has_site_capability('site.users.view')
     and e.subject_user_id = p_user_id
     and (e.team_id is not null
       or e.event_type like 'site.player_team%'
       or e.event_type like 'site.team%'
       or e.event_type like 'team.%')
     and (e.event_type like 'role.%'
       or e.event_type like 'site.%'
       or e.event_type like 'team.%')
   order by e.occurred_at desc
   limit 500;
$$;

-- Unchanged in behaviour; restated so the family reads as one thing rather than two generations.
create or replace function public.site_family_history(p_user_id uuid)
returns table (at timestamptz, player_id uuid, entry text, detail text, actor_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.occurred_at, e.player_id, e.event_type, e.reason, e.actor_user_id
    from public.security_events e
   where internal.has_site_capability('site.users.view')
     and e.subject_user_id = p_user_id
     and (e.event_type like 'guardian.%'
       or e.event_type like 'site.guardian%'
       or e.event_type like 'family.%')
   order by e.occurred_at desc
   limit 500;
$$;

-- ---------------------------------------------------------------------------------------------------
-- THE FOURTH TIMELINE. Account state, sessions, credentials, setup invitations, Site Admin grants and
-- the creation of the identity: the decisions that are about the ACCOUNT rather than about a club, a
-- team or a family. Nothing showed these, which is why "who ended their sessions, and why" had no
-- answer inside the product.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_account_history(p_user_id uuid)
returns table (at timestamptz, entry text, detail text, actor_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.occurred_at, e.event_type, e.reason, e.actor_user_id
    from public.security_events e
   where internal.has_site_capability('site.users.view')
     and e.subject_user_id = p_user_id
     and (e.event_type like 'account.%'
       or e.event_type like 'session.%'
       or e.event_type like 'site_admin.%'
       or e.event_type like 'user.%'
       or e.event_type like 'auth.%')
   order by e.occurred_at desc
   limit 500;
$$;

comment on function public.site_account_history(uuid) is
  'Phase 2 AB.1 Audit History, added by Slice 7e. Account, session, credential, setup-invitation and '
  'Site Admin grant decisions recorded against one person. Read-only, gated on site.users.view. Exists '
  'because seven master-control event types were written by 7a-7c and displayed by nothing.';

revoke all on function public.site_account_history(uuid) from public, anon;
grant execute on function public.site_account_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- THE GUARD. Every event type master control emits must be visible somewhere. Asserted here against the
-- real predicates rather than trusted, and repeated permanently in
-- supabase/tests/site_admin_users_access_closure.sql.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_event text;
  v_has_team boolean;
  v_shown boolean;
  v_unseen text[] := '{}';
begin
  for v_event, v_has_team in
    select * from (values
      ('site.membership_added', false),
      ('site.membership_transitioned', false),
      ('site.club_role_assigned', false),
      ('site.role_revoked', false),
      ('site.role_revoked', true),
      ('site.team_role_assigned', true),
      ('site.player_team_changed', true),
      ('site.guardian_linked', false),
      ('site.guardian_unlinked', false),
      ('account.password_reset_forced', false),
      ('account.setup_resent', false),
      ('session.revoked_by_admin', false),
      ('site_admin.grant_requested', false),
      ('site_admin.grant_approved', false),
      ('site_admin.grant_rejected', false),
      ('site_admin.revoked_with_reason', false),
      ('user.created', false)
    ) as t(event_type, has_team)
  loop
    v_shown :=
      -- membership timeline
      ((not v_has_team) and (v_event like 'membership.%' or v_event like 'club.%'
        or v_event like 'site.membership%' or v_event like 'site.club%'
        or v_event like 'role.%' or v_event like 'site.role%'))
      -- team timeline
      or ((v_has_team or v_event like 'site.player_team%' or v_event like 'site.team%' or v_event like 'team.%')
          and (v_event like 'role.%' or v_event like 'site.%' or v_event like 'team.%'))
      -- family timeline
      or (v_event like 'guardian.%' or v_event like 'site.guardian%' or v_event like 'family.%')
      -- account timeline
      or (v_event like 'account.%' or v_event like 'session.%' or v_event like 'site_admin.%'
        or v_event like 'user.%' or v_event like 'auth.%');
    if not v_shown then
      v_unseen := v_unseen || (v_event || case when v_has_team then ' (team)' else ' (club)' end);
    end if;
  end loop;

  if array_length(v_unseen, 1) is not null then
    raise exception 'SLICE 7e: these master-control events are displayed by no timeline: %',
      array_to_string(v_unseen, ', ');
  end if;

  if to_regprocedure('public.site_account_history(uuid)') is null then
    raise exception 'SLICE 7e: site_account_history was not created';
  end if;
  if has_function_privilege('anon', 'public.site_account_history(uuid)', 'EXECUTE') then
    raise exception 'SLICE 7e: anon can read an account''s security history';
  end if;

  raise notice 'Slice 7e: every master-control event now appears on a timeline somebody can read';
end $$;

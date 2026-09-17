-- =====================================================================================================
-- SLICE 7 (5/n) -- "PRESENTATION ROLES ARE NOT AUTHORITY"
--
-- WHAT THIS FOUND
--
-- 20270418 took the Site Admin label out of all ninety RLS policies, and 20270419 took
-- internal.is_site_admin() out of sixty SECURITY DEFINER bodies. Both assertions were true and both
-- are still true. They were also not the whole family.
--
-- PG-15 and PG-16 as the design writes them name is_site_admin(); PG-15 additionally names
-- is_full_site_admin() and is_club_admin(), PG-16 does not. So after two green migrations, THIRTY
-- function bodies still decided authority with
--
--     if not internal.is_full_site_admin() then raise ... 42501
--
-- and internal.is_full_site_admin() is, in full:
--
--     is_account_active(auth.uid()) and coalesce(internal.site_admin_role(auth.uid()),'') = 'full'
--
-- -- a string comparison against site_admins.admin_role. That column is the PRESENTATION role: the
-- word the Site Admins screen shows. It is kept in step with profile_key by a trigger, it is not the
-- authority model, and reading it skips capability_decision entirely -- which means it skips the AAL
-- requirement, the session liveness check, the account-state check and any per-person capability
-- override. Three of those are the whole of Slice 6.
--
-- A grep count alone would not justify touching these, and the brief says so. So each of the
-- thirty-four was read and mapped to the capability that NAMES ITS OPERATION, and the effect of each
-- mapping on who may act is stated below and asserted at the end.
--
-- WHAT CHANGES FOR WHOM
--
-- Twenty-nine mappings are exact: the capability is held by SITE_FULL alone, so the same people can
-- do the same things, now through a resolver that also asks whether their session is live and recent.
--
-- Three deliberately widen, and each widens to the profile that owns the domain. This is the
-- intended outcome of the slice rather than a side effect: authority should follow the named job.
--   * withdraw_announcement          -> site.messages.moderate     (+ SITE_MOD)
--   * request_fixture_restoration    -> site.fixtures.support      (+ SITE_OPS)
--   * competition_organiser_recipients -> site.competitions.manage (+ SITE_OPS)   [audience, not authority]
--
-- Two deliberately narrow, back onto the operation's own capability:
--   * guard_club_membership_revival  -> site.memberships.manage    (-SITE_SUPPORT)
--   * set_account_status             -> REPLACED (see below)
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
-- internal.is_club_admin() survives in three bodies (can_manage_club_fixtures, can_manage_team,
-- request_fixture_restoration). It is NOT the same kind of thing: it tests a canonical
-- club_memberships role, not a cosmetic label, and club authority is not Slice 7's to redraw.
-- Rewriting it would be exactly the grep-count-driven deletion the brief prohibits. Recorded for the
-- slice that owns club authority.
-- =====================================================================================================

do $$
declare
  r record; v_def text; v_key text; v_n int := 0;
  v_map jsonb;
begin
  -- Hand-authored, one line per function, grouped by the operation each one performs.
  select jsonb_object_agg(fn, cap) into v_map from (values
    -- EMAIL. Sending as Ovalball, addressing the platform-wide audience, and the template estate.
    ('assert_may_manage_email_templates','site.email.manage'),
    ('may_send_as','site.email.manage'),
    ('resolve_audience','site.email.manage'),
    ('claim_test_email_send','site.email.manage'),
    ('my_sender_identities','site.email.manage'),
    ('platform_eligible_audience_summary','site.email.manage'),
    ('platform_eligible_recipients','site.email.manage'),
    ('set_email_event_active','site.email.manage'),
    -- SITE ADMIN ADMINISTRATION. Granting and revoking the add-on capabilities themselves.
    ('revoke_site_admin_invitation','site.admins.manage'),
    ('set_site_admin_commercial_capability','site.admins.manage'),
    ('set_site_admin_competitions_capability','site.admins.manage'),
    ('set_site_admin_diagnostic_capability','site.admins.manage'),
    ('set_site_admin_fixture_support_capability','site.admins.manage'),
    ('set_site_admin_global_lookups_capability','site.admins.manage'),
    ('set_site_admin_permissions_capability','site.admins.manage'),
    ('set_site_admin_seasons_capability','site.admins.manage'),
    ('set_site_admin_system_capability','site.admins.manage'),
    ('set_site_admin_team_catalogue_capability','site.admins.manage'),
    -- CLUB PEOPLE.
    ('assert_club_keeps_an_admin','site.club_roles.manage'),
    ('change_membership_access_profile','site.club_roles.manage'),
    ('grant_club_membership','site.memberships.manage'),
    -- CLUB IDENTITY. A rugby code correction re-homes the club's whole catalogue, so it is a
    -- lifecycle act, not the profile edit that site.clubs.profile.manage describes.
    ('correct_club_rugby_code','site.clubs.lifecycle'),
    -- FIXTURES.
    ('request_fixture_restoration','site.fixtures.support'),
    ('resolve_fixture_result_dispute','site.fixtures.support'),
    ('bulk_update_fixtures','site.fixtures.support'),
    -- PLATFORM CONFIGURATION.
    ('set_platform_scheduling_defaults','site.system.beta.manage'),
    -- MESSAGING. Turning a team conversation on is policy; withdrawing somebody's announcement is
    -- moderation, and SITE_MOD is the profile whose job that is.
    ('set_team_conversation_active','site.messages.policy.manage'),
    ('team_conversation_state','site.messages.policy.manage'),
    ('withdraw_announcement','site.messages.moderate')
  ) as t(fn, cap);

  for r in
    select p.oid, p.proname, n.nspname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','internal')
       and (p.prosrc ~ '\mis_full_site_admin\s*\(' or p.prosrc ~ '\mis_site_admin\s*\(')
       -- can_run_directory_verification is re-created whole further down: its label check sits in a
       -- disjunction with a second role branch, and a substitution would leave the second branch
       -- behind. may_complete_player_profile is dropped. The rest are the helpers themselves.
       and p.proname not in ('is_full_site_admin','is_site_admin','may_complete_player_profile',
                             'can_run_directory_verification')
     order by n.nspname, p.proname
  loop
    v_key := v_map ->> r.proname;
    if v_key is null then
      raise exception 'Slice 7: %.% authorises on the presentation role and has no mapping. Map it deliberately or explain why it stays.', r.nspname, r.proname;
    end if;
    -- A retired capability is refused by capability_decision at rule 1, which would deny EVERYBODY
    -- including a Full Site Admin. That is an authority LOSS, and it is much harder to notice than a
    -- widening because nothing starts working that should not.
    if not exists (select 1 from public.capabilities c where c.key = v_key and c.status = 'ACTIVE') then
      raise exception 'Slice 7: %.% would be mapped to %, which is not an ACTIVE capability.', r.nspname, r.proname, v_key;
    end if;

    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(v_def, '\m(internal\.)?is_full_site_admin\(\)',
                            format('internal.has_site_capability(%L)', v_key), 'g');
    v_def := regexp_replace(v_def, '\m(internal\.)?is_site_admin\(\)',
                            format('internal.has_site_capability(%L)', v_key), 'g');
    execute v_def;
    v_n := v_n + 1;
  end loop;
  raise notice 'Slice 7: % function bodies moved off the presentation role', v_n;
end $$;

-- =====================================================================================================
-- THE FOUR THAT A SUBSTITUTION CANNOT DO, because the label appears in a disjunction that has to go
-- as a whole rather than become one branch of itself.
-- =====================================================================================================

-- Directory verification was `full OR club_data`. site.directory.manage is held by exactly SITE_DATA
-- and SITE_FULL, so this is the same set of people, said properly.
create or replace function internal.can_run_directory_verification()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.has_site_capability('site.directory.manage');
$$;

-- Result disputes were `full OR fixture_ops`. site.fixtures.support is SITE_FULL and SITE_OPS.
-- (The body below is re-created by the loop above; this only removes the leftover role branch.)
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_fixture_result_dispute';
  v_def := regexp_replace(v_def,
    '\s*or\s+coalesce\(internal\.site_admin_role\(auth\.uid\(\)\),\s*''''\)\s*=\s*''fixture_ops''', '', 'g');
  execute v_def;
end $$;

-- Restoring a revoked membership was `full OR user_access`. It becomes the capability that names the
-- operation -- the same one public.site_add_club_membership asks for -- which is a NARROWING:
-- SITE_SUPPORT no longer restores a revoked membership by editing the row. SITE_SUPPORT was never
-- meant to reach club membership state; that is what site.memberships.manage is for.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'guard_club_membership_revival';
  v_def := replace(v_def,
    'coalesce(internal.site_admin_role(auth.uid()), '''') not in (''full'', ''user_access'')',
    'not internal.has_site_capability(''site.memberships.manage'')');
  execute v_def;
end $$;

-- Who is TOLD about a competition edition with no organising club. This is an audience, not an
-- authority: nobody gains the power to do anything by being on it. sa.manage_competitions is an
-- explicit per-person grant and is kept exactly as it was -- the brief warns specifically against
-- removing legitimate explicit capabilities while tidying labels away.
create or replace function internal.competition_organiser_recipients(p_edition_id uuid)
returns table (user_id uuid) language sql stable security definer set search_path = '' as $$
  select cm.user_id
    from public.competition_editions e
    join public.competitions c on c.id = e.competition_id
    join public.club_memberships cm on cm.club_id = c.organiser_club_id
         and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
   where e.id = p_edition_id
  union
  select sa.user_id
    from public.competition_editions e
    join public.competitions c on c.id = e.competition_id
    join public.site_admins sa on sa.status = 'active'
         and (exists (select 1 from public.bundle_capabilities bc
                       where bc.bundle_key = sa.profile_key
                         and bc.capability_key = 'site.competitions.manage')
              or sa.manage_competitions)
   where e.id = p_edition_id and c.organiser_club_id is null;
$$;

-- =====================================================================================================
-- THE SUPPORT LEVEL. internal.site_admin_support_level(uuid) translated the presentation role into
-- 'manage' / 'view' / 'none' for exactly two callers, both of which pass auth.uid(). Its three
-- outcomes already have capabilities that describe them precisely, so the translation step is
-- removed rather than rewritten -- a helper that turns a label into an authority word is the hazard,
-- not the word.
--
--   full, user_access -> 'manage'  ==  site.support.manage  (SITE_FULL, SITE_SUPPORT)
--   read_only         -> 'view'    ==  site.support.view    (SITE_FULL, SITE_RO, SITE_SUPPORT)
--
-- Both sets match exactly, so nobody gains or loses support access here.
-- =====================================================================================================
create or replace function internal.can_manage_support()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.is_account_active(auth.uid()) and internal.has_site_capability('site.support.manage');
$$;

create or replace function internal.can_access_support_attachment_path(p_object_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_ticket_id uuid;
begin
  v_ticket_id := (storage.foldername(p_object_name))[1]::uuid;
  if p_write then
    return exists (select 1 from public.support_tickets
                    where id = v_ticket_id and created_by_user_id = auth.uid() and status <> 'closed');
  end if;
  return exists (select 1 from public.support_tickets t
                  where t.id = v_ticket_id
                    and (t.created_by_user_id = auth.uid()
                         or internal.has_site_capability('site.support.view')));
exception when invalid_text_representation then return false;
end $$;

-- ...and three RLS POLICIES called it directly.
--
-- This is the more interesting half of the finding. PG-15 asks whether any policy mentions
-- is_site_admin / is_full_site_admin / is_club_admin, and the answer has been a truthful zero since
-- 20270418. These three policies decided support visibility from site_admins.admin_role the whole
-- time, through a helper whose name contains none of those words. The invariant was not wrong; it
-- was narrower than the sentence people read it as. The assertion in
-- supabase/tests/authority_helper_retirement.sql is widened to match, so the next helper that
-- launders the label into an authority word fails a test instead of passing one.
--
-- Both substitutions are exact -- 'manage'/'view' is precisely site.support.view's holders
-- (SITE_FULL, SITE_RO, SITE_SUPPORT) and 'manage' is precisely site.support.manage's (SITE_FULL,
-- SITE_SUPPORT) -- so no support ticket changes hands. They are wrapped in a scalar sub-select so
-- the resolver is hoisted to an InitPlan and runs once per query rather than once per ticket.
drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
using (created_by_user_id = auth.uid()
       or (select internal.has_site_capability('site.support.view')));

drop policy if exists support_ticket_events_select on public.support_ticket_events;
create policy support_ticket_events_select on public.support_ticket_events for select to authenticated
using (
  (visibility = 'requester' and (
     exists (select 1 from public.support_tickets t
              where t.id = support_ticket_events.ticket_id and t.created_by_user_id = auth.uid())
     or (select internal.has_site_capability('site.support.view'))))
  or (visibility = 'internal' and (select internal.has_site_capability('site.support.manage')))
);

drop policy if exists support_ticket_attachments_select on public.support_ticket_attachments;
create policy support_ticket_attachments_select on public.support_ticket_attachments for select to authenticated
using (
  exists (select 1 from public.support_tickets t
           where t.id = support_ticket_attachments.ticket_id and t.created_by_user_id = auth.uid())
  or (select internal.has_site_capability('site.support.view'))
);

drop function if exists internal.site_admin_support_level(uuid);

-- =====================================================================================================
-- TWO FUNCTIONS THAT GO.
--
-- internal.may_complete_player_profile: CLAUDE.md has carried a standing note that this has no
-- callers and "retires with the Slice 7 site-admin pass; do not build on it". It is that pass. Its
-- last branch was is_full_site_admin(), so leaving it would have left a dead label helper sitting
-- exactly where somebody looking for a player-profile authority answer would find it before they
-- found internal.can_player_as_family.
--
-- public.set_account_status: the real escape hatch, and the reason this migration exists at all. The
-- Users & Access screen called it to suspend and reinstate accounts. It authorised on
-- `site_admin_role in ('full','user_access')`, took NO reason, required NO recent authenticator code
-- and emitted NO security event -- so an account could be suspended with no record of why, by an
-- authority check that Slice 6 could not reach. public.site_set_account_state replaces it with the
-- Q.3 preamble, and additionally separates DISABLED (site.users.disable) from SUSPENDED
-- (site.users.security.manage), which set_account_status could not express because it only ever
-- looked at a label. The caller moves with it.
-- =====================================================================================================
drop function if exists internal.may_complete_player_profile(uuid);
drop function if exists public.set_account_status(uuid, text);
drop function if exists internal.is_full_site_admin();

do $$
declare v_bodies int; v_policies int; v_left text;
begin
  select count(*) into v_bodies from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal')
     and (p.prosrc ~ '\mis_full_site_admin\s*\(' or p.prosrc ~ '\mis_site_admin\s*\(');
  -- Deliberately wider than PG-15: any policy that reaches the presentation role by ANY route,
  -- including through a helper that renames it on the way.
  select count(*) into v_policies from pg_policies
   where schemaname in ('public','storage')
     and (coalesce(qual,'')||' '||coalesce(with_check,''))
         ~ '\m(is_site_admin|is_full_site_admin|site_admin_role|site_admin_support_level)\s*\(';
  if v_bodies <> 0 or v_policies <> 0 then
    raise exception 'Slice 7: % bodies and % policies still decide authority from the Site Admin label', v_bodies, v_policies;
  end if;

  select string_agg(n.nspname||'.'||p.proname, ', ') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal') and p.prosrc ~ 'site_admin_role\s*\('
     and p.proname not in ('site_admin_role','site_admin_profile_sync','site_profile_for_admin_role',
                           'admin_role_for_site_profile','accept_site_admin_invitation',
                           'get_site_admin_invitation_preview','redeem_invitation');
  if v_left is not null then
    raise exception 'Slice 7: these still read the presentation role outside the declared adapters: %', v_left;
  end if;

  raise notice 'Slice 7: presentation-role authority retired; the label is display only';
end $$;

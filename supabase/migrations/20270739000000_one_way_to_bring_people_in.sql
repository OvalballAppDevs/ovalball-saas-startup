-- =====================================================================================================
-- ONE WAY TO BRING PEOPLE IN (People & Invitations programme, 2026-10-05)
--
-- The owner's brief: one person, one club relationship, one invitation engine, one role model, one
-- access model, many contextual ways in. The audit found the engine already exists
-- (access_invitations, issued and redeemed by issue_invitation / redeem_invitation) and that the
-- fragmentation was around it: a Team Staff screen that said staff invitations did not exist while
-- People issued them, role lists that disagreed (the invitation ceiling had no First Aider or Team
-- Safeguarding Lead, the People read model could not see either), a staff invitation that admitted its
-- invitee by writing the membership directly (provenance LEGACY_BACKFILL, no source invitation, and a
-- unique-index failure for anyone who had asked to join), and no way to describe what somebody does
-- without inventing a role. Nothing here adds a table, a role, an invitation kind or a membership state.
--
--   1. DESCRIPTIVE TITLES ARE WORDS, NEVER PRIVILEGES. A club title (club_memberships.governance_title)
--      and a team title (role_assignments.attributes.staff_title) describe what somebody does --
--      "Treasurer", "Physio", "Strength & Conditioning Coach". They grant nothing, and the server
--      refuses a title that is the name of a governed role or administration, so a title can never
--      be read as one.
--   2. THE STAFF INVITATION CARRIES THE WHOLE CATALOGUE A CLUB ADMIN CAN ALREADY GIVE: Member, First
--      Aider and Team Safeguarding Lead join the ceiling; Volunteer can be given at a team; club access
--      is ONE seat; the club's and each team's descriptive titles travel with it.
--   3. ACCEPTING IT ADMITS THE PERSON THROUGH THE ONE ADMISSION PATH (admit_club_member), so the
--      membership records INVITATION and the invitation it came from; a deactivated membership is
--      refused rather than resurrected; club access is raised, never lowered.
--   4. ONE REGISTER: club_people returns players (to the people who may see the club's rosters), every
--      team role a person holds, their club title and access, and each open invitation's real offer.
--   5. A Team Admin may give Volunteer at their own team -- the bundle First Aider and Team
--      Safeguarding Lead (which they already give) carry, so no capability they could not already
--      confer.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. WORDS THAT DESCRIBE, AND WORDS THAT ARE ALREADY A ROLE
-- -----------------------------------------------------------------------------------------------------

-- The names a descriptive title may not take: every governed role's label, and the words people use
-- for administration and safeguarding. "Club Welfare Officer" is the RFU's former name for the Club
-- Safeguarding Officer, so a free-text "Welfare Officer" would read as an appointment that Ovalball
-- confirms and this title never was.
create or replace function internal.descriptive_title_ok(p_title text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_title is null
      or not exists (
        select 1
          from (select lower(rd.label) as word from public.role_definitions rd
                union all
                select w from unnest(array[
                  'admin', 'administrator', 'club admin', 'club administrator', 'team admin', 'team administrator',
                  'fixtures secretary', 'fixture secretary', 'fixtures admin', 'site admin', 'site administrator',
                  'ovalball admin', 'safeguarding', 'safeguarding lead', 'club safeguarding officer',
                  'welfare officer', 'club welfare officer']) w) g
         where g.word = lower(btrim(regexp_replace(p_title, '\s+', ' ', 'g'))));
$$;
revoke all on function internal.descriptive_title_ok(text) from public, anon, authenticated;

-- One spelling for a team title. The Coach role's two long-standing titles stay codes (HEAD_COACH,
-- ASSISTANT_COACH) whichever way they arrive, so a typed "Head Coach" and the picker's Head Coach are
-- the same title rather than two.
create or replace function internal.team_title_value(p_role_key text, p_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when s.v is null then null
           when p_role_key = 'COACH' and upper(replace(s.v, ' ', '_')) in ('HEAD_COACH', 'ASSISTANT_COACH')
             then upper(replace(s.v, ' ', '_'))
           else s.v
         end
    from (select nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), '') as v) s;
$$;
revoke all on function internal.team_title_value(text, text) from public, anon, authenticated;

-- Which roles may be held at a team: the TEAM roles, and Volunteer, which the catalogue already
-- declares CLUB_OR_TEAM. role_is_team_scoped (TEAM only) keeps its meaning -- "must name a team" --
-- because a Volunteer may equally be club-wide.
create or replace function internal.role_allowed_at_team(p_role_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select rd.scope in ('TEAM', 'CLUB_OR_TEAM') from public.role_definitions rd where rd.role_key = p_role_key), false);
$$;
revoke all on function internal.role_allowed_at_team(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 2. THE STAFF INVITATION'S CEILING IS WHAT A CLUB ADMIN CAN ALREADY GIVE
--
-- Member is what admission grants anyway; First Aider and Team Safeguarding Lead are given by a Club
-- Admin (and a Team Admin) through assign_role today, and both are minor-prohibited, which redemption's
-- age gate already reads from the catalogue. Team Administration and Safeguarding Officer stay out:
-- the first rests on a base role and is given once the person is here, the second is appointed through
-- nomination and Ovalball's confirmation, never by invitation.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.invitation_club_staff_ceiling()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER', 'VOLUNTEER',
               'COACH', 'TEAM_MANAGER', 'FIRST_AIDER', 'TEAM_SAFEGUARDING_LEAD']::text[];
$$;

-- -----------------------------------------------------------------------------------------------------
-- 3. A TEAM ADMIN MAY GIVE VOLUNTEER AT THEIR OWN TEAM
--
-- Evidence, not a new grant of authority: VOLUNTEER, FIRST_AIDER and TEAM_SAFEGUARDING_LEAD resolve to
-- the identical VO bundle (membership-level views plus the pitch allocation view), and the other two are
-- already TEAM_ADMIN-assignable. A club-wide Volunteer stays CLUB/SITE: assign_role resolves a grant with
-- no team through club_people_authority, which never answers TEAM_ADMIN.
-- -----------------------------------------------------------------------------------------------------
update public.role_definitions
   set assignable_by = array['SITE', 'CLUB', 'TEAM_ADMIN']::text[]
 where role_key = 'VOLUNTEER'
   and not ('TEAM_ADMIN' = any (assignable_by));

-- ONE NAME FOR TEAM ADMIN. The catalogue said "Team Administration" while every screen, the legacy
-- projection (internal.team_role_label) and grant_role's own refusal said "Team Admin". The catalogue is
-- where a role is named (20270518000000 renamed Fixture Secretary here for the same reason), so it now
-- says what the product says.
update public.role_definitions
   set label = 'Team Admin'
 where role_key = 'TEAM_ADMINISTRATION'
   and label <> 'Team Admin';

-- -----------------------------------------------------------------------------------------------------
-- 4. A TEAM TITLE ON ANY TEAM ROLE
--
-- set_team_role_title wrote only HEAD_COACH / ASSISTANT_COACH onto a Coach. A team's Physio, Kit
-- Manager or Strength & Conditioning Coach had nowhere to be written. The authority is unchanged --
-- whoever may grant or revoke this exact assignment may describe it -- and so is the audit row.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.set_team_role_title(p_assignment_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.role_assignments;
  v_role public.role_definitions;
  v_level text;
  v_title text;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select * into v_assignment from public.role_assignments where id = p_assignment_id for update;
  if v_assignment.id is null then
    raise exception 'That role assignment was not found.' using errcode = 'P0002';
  end if;
  if v_assignment.team_id is null then
    raise exception 'A team title belongs to a team role. A club-wide description is the person''s club title.' using errcode = '23514';
  end if;
  if v_assignment.state <> 'ACTIVE' then
    raise exception 'That role is not currently active.' using errcode = '23514';
  end if;

  v_title := internal.team_title_value(v_assignment.role_key, p_title);
  if v_title in ('HEAD_COACH', 'ASSISTANT_COACH') then
    null;   -- the Coach role's own titles; team_title_value only produces them on a Coach
  elsif upper(replace(coalesce(v_title, ''), ' ', '_')) in ('HEAD_COACH', 'ASSISTANT_COACH') then
    raise exception 'A coaching title can only be set on a Coach role.' using errcode = '23514';
  elsif v_title is not null and length(v_title) > 60 then
    raise exception 'Keep the title to 60 characters or fewer.' using errcode = '22023';
  elsif not internal.descriptive_title_ok(v_title) then
    raise exception '"%" is reserved for a role that carries access, so it cannot be used as a custom role. Choose that role instead.', v_title
      using errcode = '22023';
  end if;

  select * into v_role from public.role_definitions where role_key = v_assignment.role_key;
  -- THE SAME TEST assign_role/transition_role_assignment RUN before touching this exact role
  -- assignment: whoever may grant or revoke the role may also describe it.
  v_level := internal.team_people_level(v_assignment.club_id, v_assignment.team_id);
  if v_level is null or not (v_level = any (v_role.assignable_by)) then
    raise exception 'You are not authorised to change this team''s staff titles.' using errcode = '42501';
  end if;

  update public.role_assignments
     set attributes = case when v_title is null then attributes - 'staff_title' else jsonb_set(attributes, '{staff_title}', to_jsonb(v_title)) end,
         updated_at = now()
   where id = p_assignment_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('role_assignments', p_assignment_id, 'update', auth.uid(), jsonb_build_object('staff_title', v_title));
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 5. A CLUB TITLE IS A DESCRIPTION TOO
-- -----------------------------------------------------------------------------------------------------
create or replace function public.set_membership_governance_title(p_membership_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_title text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), '');
  v_prev text;
begin
  select * into v_membership from public.club_memberships where id = p_membership_id for update;
  if v_membership.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  if internal.club_people_authority(v_membership.club_id) is null then
    raise exception 'You are not authorised to change titles at this club.' using errcode = '42501';
  end if;
  if v_title is not null and length(v_title) > 80 then
    raise exception 'Keep the title to 80 characters or fewer.' using errcode = '22023';
  end if;
  if not internal.descriptive_title_ok(v_title) then
    raise exception '"%" is reserved for a role that carries access, so it cannot be a club title. Choose that role instead.', v_title using errcode = '22023';
  end if;
  v_prev := internal.membership_sync_on();
  update public.club_memberships set governance_title = v_title, updated_by = auth.uid() where id = p_membership_id;
  perform internal.membership_sync_restore(v_prev);
end;
$$;
-- -----------------------------------------------------------------------------------------------------
-- 6. ISSUE: ONE SEAT, CLUB ROLES KEPT APART, TEAM TITLES CARRIED, A PERSONAL CODE FOR A PLAYER
--
-- The live definition (20270528000000) with only the CLUB_STAFF block and the TEAM_JOIN_CODE outcome
-- changed. Authority, the derived club, the team checks, uniqueness and the secrets are as they were.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_invitation(p_kind text, p_club_id uuid DEFAULT NULL::uuid, p_team_id uuid DEFAULT NULL::uuid, p_player_id uuid DEFAULT NULL::uuid, p_club_directory_id uuid DEFAULT NULL::uuid, p_target_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text, p_intended_outcome jsonb DEFAULT '{}'::jsonb, p_max_uses integer DEFAULT NULL::integer, p_team_ids uuid[] DEFAULT NULL::uuid[], p_team_roles jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(invitation_id uuid, token text, code text, expires_at timestamp with time zone, already_existed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_spec record;
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(nullif(p_email, '')));
  v_token text; v_code text;
  v_id uuid; v_existing uuid;
  v_roles text[]; v_team_roles text[]; v_teams jsonb;
  v_max int; v_club uuid := p_club_id; v_outcome jsonb;
  v_body uuid;   -- CONVERGENCE STEP 16: the organisation a GOVERNING_BODY_OFFICER invitation is for.
  v_club_roles text[];   -- ONE WAY TO BRING PEOPLE IN: what is given at the club, apart from the teams
  v_declared text; v_name text;
  v_title text; v_title_role text;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_spec from internal.invitation_kind_spec(p_kind);
  if v_spec.issuer_capability is null then
    raise exception 'Unknown invitation kind.' using errcode = '22023';
  end if;

  -- The club a team or player belongs to is DERIVED, never taken from the caller.
  if p_team_id is not null then
    select t.club_id into v_club from public.teams t where t.id = p_team_id;
    if v_club is null then raise exception 'Team not found.' using errcode = 'P0002'; end if;
  elsif p_player_id is not null then
    select ptm.team_id, t.club_id into p_team_id, v_club
      from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
     where ptm.player_id = p_player_id and ptm.status = 'active' limit 1;
  end if;

  -- CONVERGENCE STEP 16 -- THE ORGANISATION AN INVITATION IS FOR.
  --
  -- It travels in p_intended_outcome rather than a new parameter, and that is deliberate: adding
  -- p_body_id would create an overload that makes every existing two-or-three-argument call
  -- ambiguous, and dropping this function to re-add it would put a contract surface at risk for no
  -- product gain. For this kind the organisation genuinely IS part of the intended outcome -- "become
  -- Competitions Officer at this body" -- and it is validated here and written to its own COLUMN, so
  -- the scope is a real column for scope_key, the live-uniqueness index and RLS.
  if p_kind = 'GOVERNING_BODY_OFFICER' then
    v_body := nullif(p_intended_outcome->>'constituent_body_id', '')::uuid;
    if v_body is null then
      raise exception 'A governing body invitation must say which organisation it is for.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.constituent_bodies b where b.id = v_body and b.active) then
      raise exception 'Governing body not found.' using errcode = 'P0002';
    end if;
    if coalesce(p_intended_outcome->>'role_key', '') not in ('BODY_ADMIN', 'BODY_COMPETITIONS', 'BODY_VIEWER') then
      raise exception 'A governing body invitation must say which role it is for.' using errcode = '22023';
    end if;
    -- A club or a team alongside makes the scope malformed: an organisation is not inside a club.
    if p_club_id is not null or p_team_id is not null or p_player_id is not null then
      raise exception 'A governing body invitation is for an organisation, not a club or a team.' using errcode = '22023';
    end if;
  end if;

  if not (
      (v_spec.scope_type = 'site'  and internal.has_site_capability(v_spec.issuer_capability))
      or (v_spec.scope_type = 'club'  and v_club is not null and internal.can(v_spec.issuer_capability, 'club', v_club, null, null))
      or (v_spec.scope_type = 'team'  and v_club is not null and internal.can(v_spec.issuer_capability, 'team', v_club, p_team_id, null))
      -- Only the player: a club or a team alongside makes the scope malformed, because child scope
      -- is the canonical answer to "may I act for THIS CHILD" and nothing else narrows it.
      or (v_spec.scope_type = 'child' and p_player_id is not null and internal.can(v_spec.issuer_capability, 'child', null, null, p_player_id))
      -- ORGANISATION SCOPE IS RESOLVED BY THE DEDICATED PREDICATE, not by internal.can.
      --
      -- `organisation` is the canonical scope name -- it is already reserved in
      -- public.capabilities.valid_scopes and already named in internal.capability_decision, which
      -- refuses it at rule 1 with SCOPE_NOT_IMPLEMENTED. Until that scope is implemented (a
      -- whole-platform change to the most-called function in the platform), governing authority is
      -- the one relationship chain internal.body_role -> can_manage_body. The spec row NAMES the
      -- authority so the vocabulary has one home; this line is where it resolves.
      or (v_spec.scope_type = 'organisation' and v_body is not null and internal.can_manage_body(v_body))
      or (v_spec.site_alternative is not null and internal.has_site_capability(v_spec.site_alternative))
    ) then
    raise exception 'You are not authorised to send that invitation.' using errcode = '42501';
  end if;

  v_outcome := coalesce(p_intended_outcome, '{}'::jsonb);

  if p_kind = 'CLUB_STAFF' then
    -- Two ways in, one stored shape. p_team_ids is the ordinary case -- these teams get whichever of
    -- the invitation's roles are held at a team. p_team_roles is for the invitation that genuinely
    -- differs per team. Accepting both at once would be two answers to one question.
    if p_team_ids is not null and p_team_roles is not null then
      raise exception 'Name the teams once, either as a list or with their own roles.' using errcode = '22023';
    end if;

    v_roles := coalesce(array(select jsonb_array_elements_text(v_outcome->'roles')), '{}');

    -- CLUB ACCESS IS ONE SEAT (People & Invitations). Club Admin, Fixture Secretary and Member are
    -- alternatives -- what somebody can do across the whole club -- so an invitation names one of them
    -- or none, never two.
    if (select count(*) from unnest(v_roles) r where r in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')) > 1 then
      raise exception 'Choose one level of club access: Club Admin, Fixture Secretary or Member.' using errcode = '22023';
    end if;

    -- WHAT IS GIVEN AT THE CLUB, KEPT APART FROM WHAT IS GIVEN AT A TEAM. Redemption used to grant every
    -- role that was not TEAM-scoped at the club, which was harmless only while nothing CLUB_OR_TEAM could
    -- be named at a team. A Volunteer can now be named at a team, and must not become a club-wide
    -- Volunteer as a side effect, so the club-wide list is stored as said.
    v_club_roles := coalesce(array(select r from unnest(v_roles) r where not internal.role_is_team_scoped(r)), '{}');

    -- THE PERSON'S OWN WORDS FOR WHAT THEY DO, and a name to greet them by. Both describe; neither grants.
    v_declared := nullif(btrim(regexp_replace(coalesce(v_outcome->>'declared_role', ''), '\s+', ' ', 'g')), '');
    if v_declared is not null and length(v_declared) > 80 then
      raise exception 'Keep their role at the club to 80 characters or fewer.' using errcode = '22023';
    end if;
    -- Refused here rather than dropped at acceptance: a declared "Team Manager" would otherwise be shown
    -- to the invitee, and on the register, as what they are, beside access that says otherwise.
    if not internal.descriptive_title_ok(v_declared) then
      raise exception '"%" is reserved for a role that carries access, so it cannot be their role at the club. Choose that role instead.', v_declared
        using errcode = '22023';
    end if;
    v_name := nullif(btrim(regexp_replace(coalesce(v_outcome->>'invitee_name', ''), '\s+', ' ', 'g')), '');
    if v_name is not null and length(v_name) > 80 then
      raise exception 'Keep their name to 80 characters or fewer.' using errcode = '22023';
    end if;

    -- A scalar team is one team, not a special case: the old single-team call shape canonicalises
    -- into the list, which is why the COLUMN can stay null and still lose nothing.
    if p_team_roles is null then
      -- Which of this invitation's roles are actually held at a team. If none are, the invitation is
      -- club-scoped and there is nothing to assign at a team.
      v_team_roles := coalesce(array(select r from unnest(v_roles) r where internal.role_is_team_scoped(r)), '{}'::text[]);

      v_teams := case when v_team_roles = '{}'::text[] then '[]'::jsonb else
        coalesce((select jsonb_agg(jsonb_build_object('id', t, 'roles', to_jsonb(v_team_roles)) order by t)
                    from (select distinct t from unnest(
                            coalesce(p_team_ids, '{}'::uuid[]) ||
                            case when p_team_id is null then '{}'::uuid[] else array[p_team_id] end) t) d),
                 '[]'::jsonb) end;

      -- A team NAMED explicitly must end up with something. The scalar p_team_id is different: for
      -- CLUB_STAFF it is context from the old call shape, not an assignment (Y.12), so it is dropped
      -- rather than turned into an error.
      if coalesce(array_length(p_team_ids, 1), 0) > 0 and v_teams = '[]'::jsonb then
        raise exception 'That invitation names teams, but none of its roles are held at a team.'
          using errcode = '22023';
      end if;
    else
      -- Each team once, with every role named for it and the title each role is to carry there (a
      -- Volunteer described as "Kit Manager"). A team entry naming no role is kept, so the check below
      -- refuses it in words instead of the team silently disappearing from the invitation.
      v_teams := coalesce((
        select jsonb_agg(jsonb_build_object('id', (ids.tid)::uuid, 'roles', rl.roles, 'titles', tl.titles) order by ids.tid)
          from (select distinct t->>'id' as tid from jsonb_array_elements(p_team_roles) t) ids
          cross join lateral (
            select coalesce(jsonb_agg(distinct r order by r), '[]'::jsonb) as roles
              from jsonb_array_elements(p_team_roles) t2, lateral jsonb_array_elements_text(t2->'roles') r
             where (t2->>'id') is not distinct from ids.tid) rl
          cross join lateral (
            select coalesce(jsonb_object_agg(kv.k, internal.team_title_value(kv.k, kv.val)), '{}'::jsonb) as titles
              from jsonb_array_elements(p_team_roles) t2,
                   lateral jsonb_each_text(case when jsonb_typeof(t2->'titles') = 'object' then t2->'titles' else '{}'::jsonb end) kv(k, val)
             where (t2->>'id') is not distinct from ids.tid and internal.team_title_value(kv.k, kv.val) is not null) tl),
        '[]'::jsonb);
      -- Every per-team role is part of what this invitation carries, so the ceiling, the age gate and
      -- the preview all see the whole picture rather than only the club-wide part.
      v_roles := coalesce((select array_agg(distinct r) from (
                             select unnest(v_roles) as r
                             union select jsonb_array_elements_text(t->'roles') from jsonb_array_elements(v_teams) t) u),
                          '{}');
    end if;

    if v_roles = '{}' then
      raise exception 'A staff invitation must say which roles it is for.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_roles) r where r <> all (internal.invitation_club_staff_ceiling())) then
      raise exception 'That invitation asks for a role it is not allowed to carry.' using errcode = '42501';
    end if;
    if 'CLUB_ADMIN' = any (v_roles)
       and not (internal.can('people.invitation.create', 'club', v_club, null, null)
                or internal.has_site_capability('site.memberships.manage')) then
      raise exception 'You are not authorised to invite a Club Admin.' using errcode = '42501';
    end if;

    -- A null in the list is checked FIRST and separately, because a null can never be caught by "does
    -- this team exist": the existence lookup returns no row, and a `select ... into` over no row
    -- leaves the variable null, which reads exactly like "nothing was wrong". An unnoticed null would
    -- then be stored as an authorised team.
    if exists (select 1 from jsonb_array_elements(v_teams) t where (t->>'id') is null) then
      raise exception 'That invitation names a team that is not a team.' using errcode = '22023';
    end if;

    -- Every team must exist AND belong to this invitation's club. A team from another club in the
    -- payload is the attack this rejects: it would otherwise hand a role inside somebody else's club.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where not exists (select 1 from public.teams te
                                   where te.id = (t->>'id')::uuid and te.club_id = v_club and te.active)) then
      raise exception 'That invitation names a team which is not an active team of this club.'
        using errcode = '42501';
    end if;

    -- A role held at a CLUB cannot be granted at a team, and a team entry with no roles at all is an
    -- assignment that would do nothing -- both mean the caller and the server disagree about what
    -- this invitation is, which is not something to resolve by guessing.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where jsonb_array_length(t->'roles') = 0
                   or exists (select 1 from jsonb_array_elements_text(t->'roles') r
                               where not internal.role_allowed_at_team(r))) then
      raise exception 'A team in that invitation has no role, or a role that is not held at a team.'
        using errcode = '22023';
    end if;

    -- A Coach with nowhere to coach is not a smaller invitation, it is an incoherent one.
    if exists (select 1 from unnest(v_roles) r
                where internal.role_is_team_scoped(r)
                  and not exists (select 1 from jsonb_array_elements(v_teams) t,
                                       lateral jsonb_array_elements_text(t->'roles') tr where tr = r)) then
      raise exception 'A Coach or Team Manager invitation must name at least one team.' using errcode = '22023';
    end if;

    -- A TITLE DESCRIBES A ROLE THIS INVITATION CARRIES, in words that cannot pass for a privilege. The
    -- refusal names the words, so the person sees what to change rather than a rule to decode.
    select kv.k, kv.val into v_title_role, v_title
      from jsonb_array_elements(v_teams) t,
           lateral jsonb_each_text(coalesce(t->'titles', '{}'::jsonb)) kv(k, val)
     where not ((t->'roles') ? kv.k)
        or length(kv.val) > 60
        or not internal.descriptive_title_ok(kv.val)
        or (kv.k <> 'COACH' and upper(replace(kv.val, ' ', '_')) in ('HEAD_COACH', 'ASSISTANT_COACH'))
     limit 1;
    if found then
      if length(v_title) > 60 then
        raise exception 'Keep each role name to 60 characters or fewer.' using errcode = '22023';
      elsif not internal.descriptive_title_ok(v_title) then
        raise exception '"%" is reserved for a role that carries access, so it cannot be used as a custom role. Choose that role instead.', v_title
          using errcode = '22023';
      elsif upper(replace(v_title, ' ', '_')) in ('HEAD_COACH', 'ASSISTANT_COACH') then
        raise exception 'Head Coach and Assistant Coach belong to the Coach role. Choose Coach, then the title.' using errcode = '22023';
      else
        raise exception 'A role name in that invitation belongs to a role it does not give.' using errcode = '22023';
      end if;
    end if;

    v_outcome := (v_outcome - 'declared_role' - 'invitee_name' - 'club_roles')
                 || jsonb_build_object('roles', to_jsonb(v_roles), 'teams', v_teams, 'club_roles', to_jsonb(v_club_roles))
                 || case when v_declared is null then '{}'::jsonb else jsonb_build_object('declared_role', v_declared) end
                 || case when v_name is null then '{}'::jsonb else jsonb_build_object('invitee_name', v_name) end;
    p_team_id := null;   -- Y.12: the scalar is for genuinely single-team kinds only
  end if;

  -- A JOINING CODE CARRIES NO AUTHORITY, so nothing a caller sends rides along with it except who it is
  -- meant for. A personal invitation to a player is a single-use code with the invitee's name on it; a
  -- poster's code has none. Redemption reads none of this -- it opens a request either way.
  if p_kind = 'TEAM_JOIN_CODE' then
    v_name := nullif(btrim(regexp_replace(coalesce(v_outcome->>'invitee_name', ''), '\s+', ' ', 'g')), '');
    if v_name is not null and length(v_name) > 80 then
      raise exception 'Keep their name to 80 characters or fewer.' using errcode = '22023';
    end if;
    v_outcome := case when v_name is null then '{}'::jsonb
                      else jsonb_build_object('invitee_name', v_name, 'audience', 'PLAYER') end;
  end if;

  if p_kind = 'TEAM_JOIN_CODE' then
    v_max := greatest(1, least(coalesce(p_max_uses, 50), 500));
    v_email := null;
  else
    v_max := 1;
    if v_email is null then
      raise exception 'That invitation kind needs an email address.' using errcode = '22023';
    end if;
  end if;

  if v_email is not null then
    select i.id into v_existing from public.access_invitations i
     where i.kind = p_kind and i.state = 'ISSUED' and i.invited_email_normalised = v_email
       and i.scope_key = coalesce(p_player_id::text, p_team_id::text, v_club::text, p_club_directory_id::text,
                                  v_body::text, p_target_user_id::text, 'SITE');
    if v_existing is not null then
      return query select v_existing, null::text, null::text,
                          (select a.expires_at from public.access_invitations a where a.id = v_existing), true;
      return;
    end if;
  end if;

  v_token := internal.new_invitation_token();
  v_code  := internal.new_invitation_code();

  insert into public.access_invitations (
    kind, club_id, team_id, player_id, club_directory_id, constituent_body_id, target_user_id, invited_email_normalised,
    intended_outcome, issuer_capability, issued_by, issued_level,
    token_sha256, code_hmac, code_hint, max_uses, expires_at)
  values (
    p_kind, v_club, p_team_id, p_player_id, p_club_directory_id, v_body, p_target_user_id, v_email,
    v_outcome, v_spec.issuer_capability, v_actor, v_spec.issued_level,
    internal.invitation_token_hash(v_token), internal.invitation_code_hash(v_code),
    right(replace(v_code, '-', ''), 2), v_max, now() + v_spec.lifetime)
  returning id into v_id;

  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.issued', v_actor, v_club, p_team_id, 'invitation issued',
          jsonb_build_object('invitation_id', v_id, 'kind', p_kind,
                             'teams', coalesce(jsonb_array_length(v_outcome->'teams'), 0)));

  return query select v_id, v_token, v_code, (now() + v_spec.lifetime), false;
end $function$;
-- -----------------------------------------------------------------------------------------------------
-- 7. REDEEM: ONE ADMISSION PATH, A DEACTIVATED MEMBERSHIP REFUSED, ACCESS NEVER LOWERED, TITLES APPLIED
--
-- The live definition (20270530000000) with only the CLUB_STAFF outcome block changed. Every check
-- before it -- session, rate limits, expiry persisted first, the secret's hash, the confirmed email, the
-- live scope, the issuer's authority re-checked now, the age gate -- is exactly as it was.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token text DEFAULT NULL::text, p_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v record;
  v_email text;
  v_failures int;
  v_membership uuid;
  v_role text;
  v_roles text[];
  v_result jsonb := '{}'::jsonb;
  v_existing uuid;
  v_teams jsonb;
  v_officer text;
  v_team uuid;
  v_team_roles text[];
  v_id uuid;
  v_generic constant text := 'That invitation or code can''t be used.';
  -- ONE WAY TO BRING PEOPLE IN
  v_club_roles text[];
  v_seat text;
  v_held text;
  v_titles jsonb;
  v_declared text;
  v_prev text;
begin
  -- Step 0. Redemption is an authenticated act. session_ok() is the canonical session gate; when
  -- Slice 6 adds the AAL2 requirement to it, redemption inherits that without being changed here.
  if v_actor is null then
    raise exception 'You must be signed in to accept an invitation.' using errcode = '42501';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session cannot be used for this.' using errcode = '42501';
  end if;
  if coalesce(p_token, p_code) is null then
    raise exception 'Give a link or a code.' using errcode = '22023';
  end if;

  -- Step 3. Rate limits BEFORE any lookup, so guessing is capped whether or not the guess is close.
  select count(*) into v_failures from public.invitation_redemption_attempts a
   where a.user_id = v_actor and a.outcome <> 'redeemed' and a.occurred_at > now() - interval '15 minutes';
  if v_failures >= 5 then
    perform internal.invitation_refused(null, 'throttled');
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('invitation.attempts_throttled', v_actor, 'too many invitation attempts', '{}'::jsonb);
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  select count(*) into v_failures from public.invitation_redemption_attempts a
   where a.user_id = v_actor and a.outcome <> 'redeemed' and a.occurred_at > now() - interval '1 day';
  if v_failures >= 20 then
    perform internal.invitation_refused(null, 'throttled_day');
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('invitation.attempts_throttled', v_actor, 'too many invitation attempts today', '{}'::jsonb);
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 5 (first half). Terminal states are persisted BEFORE any refusal, because a raise rolls
  -- back whatever the same transaction wrote -- the M-5 lesson.
  perform internal.expire_due_invitations();

  -- Steps 1, 4. Find it by hash, and hold the row for the rest of the transaction.
  select * into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1
   for update;

  if v.id is null then
    perform internal.invitation_refused(null, 'not_found');
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 11 (multi-use idempotency). A second redemption by the same person returns what they already
  -- have rather than making a second request.
  select r.id into v_existing from public.invitation_redemptions r
   where r.invitation_id = v.id and r.user_id = v_actor;
  if v_existing is not null then
    return jsonb_build_object('outcome','ALREADY_REDEEMED','invitation_id',v.id,'kind',v.kind);
  end if;

  -- Step 5. Missing, revoked, expired or used all give the SAME answer: a prober must not be able to
  -- tell a revoked invitation from one that never existed.
  if v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses then
    perform internal.invitation_refused(v.id, lower(v.state));
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 6. Personal invitations are bound to a verified email. The comparison is against the
  -- session's own confirmed address, never anything the caller supplied.
  if v.invited_email_normalised is not null then
    select lower(u.email) into v_email from auth.users u
     where u.id = v_actor and u.email_confirmed_at is not null;
    if v_email is null or v_email <> v.invited_email_normalised then
      perform internal.invitation_refused(v.id, 'wrong_identity');
      insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
      values ('invitation.identity_mismatch', v_actor, v.club_id, 'invitation opened by another identity',
              jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;
  end if;
  if v.kind = 'ACCOUNT_SETUP' and v.target_user_id is distinct from v_actor then
    perform internal.invitation_refused(v.id, 'wrong_identity');
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 7. The scope must still be real and usable.
  if v.club_id is not null and not exists (select 1 from public.clubs c where c.id = v.club_id and c.status = 'active') then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  if v.team_id is not null and not exists (select 1 from public.teams t where t.id = v.team_id and t.active) then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  if v.player_id is not null and not exists (select 1 from public.players p where p.id = v.player_id) then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 8. The issuer's authority is re-checked NOW. An invitation sent by somebody who has since
  -- lost the authority to send it must not still work.
  if not (
      (v.club_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'club', v.club_id, null, null)).allowed)
      or (v.team_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'team', v.club_id, v.team_id, null)).allowed)
      or (v.player_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'child', null, null, v.player_id)).allowed)
      or (v.issued_level = 'SITE' and exists (
            select 1 from public.site_admins sa where sa.user_id = v.issued_by and sa.status = 'active'))
      -- CONVERGENCE STEP 16. The same rule as every line above it: an invitation must not still work
      -- if the person who sent it has since lost the authority to send it. Asked of the ISSUER, by id,
      -- so it is their standing at the organisation that is re-checked and not the redeemer's.
      or (v.constituent_body_id is not null
          and (internal.body_role(v.constituent_body_id, v.issued_by) = 'BODY_ADMIN'
               or exists (select 1 from public.site_admins sa
                           where sa.user_id = v.issued_by and sa.status = 'active')))
    ) then
    perform internal.invitation_refused(v.id, 'issuer_authority_lost');
    insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
    values ('invitation.issuer_authority_lost', v_actor, v.club_id, 'issuer no longer holds the authority',
            jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- Steps 9 and 10. The outcome, through the canonical transitions and nothing else.
  --
  -- D-S5-1 is NOT re-implemented here. Every path below ends in internal.grant_role or
  -- internal.enter_safeguarding_nomination, which carry the gate, so a caller who reaches this
  -- function through some other route still meets it. What this function does is refuse BEFORE
  -- consuming the invitation, so a fixable refusal leaves the invitation usable.
  -- ---------------------------------------------------------------------------------------------
  if v.kind = 'SITE_ADMIN' and not internal.person_is_established_adult(v_actor) then
    perform internal.invitation_refused(v.id, 'age_eligibility_required');
    -- NOT consumed: the invitation stays usable once a date of birth is on file.
    return jsonb_build_object('outcome','REFUSED','reason','AGE_ELIGIBILITY_REQUIRED','message','Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.');
  end if;

  if v.kind in ('CLUB_STAFF','SAFEGUARDING_OFFICER') then
    v_roles := case when v.kind = 'SAFEGUARDING_OFFICER' then array['SAFEGUARDING_OFFICER']
                    else coalesce(array(select jsonb_array_elements_text(v.intended_outcome->'roles')), '{}') end;
    if exists (select 1 from unnest(v_roles) r
                join public.role_definitions rd on rd.role_key = r
               where rd.minor_prohibited)
       and not internal.person_is_established_adult(v_actor) then
      perform internal.invitation_refused(v.id, 'age_eligibility_required');
      -- NOT consumed: the invitation stays usable once a date of birth is on file.
      return jsonb_build_object('outcome','REFUSED','reason','AGE_ELIGIBILITY_REQUIRED','message','Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.');
    end if;
  end if;

  if v.kind = 'CLUB_STAFF' then
    -- The authorised teams come from the STORED invitation. Redemption takes no team argument, so
    -- there is nothing for a browser to substitute.
    v_teams := coalesce(v.intended_outcome->'teams', '[]'::jsonb);

    -- Validated here, before ANY part of the outcome is written: every team must still be an active
    -- team of this club, or the invitation stays unspent and the person is left exactly as they were.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where not exists (select 1 from public.teams te
                                   where te.id = (t->>'id')::uuid and te.club_id = v.club_id and te.active)) then
      perform internal.invitation_refused(v.id, 'scope_gone');
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;

    -- ONE ADMISSION PATH (People & Invitations). This used to INSERT the membership itself, which
    -- recorded no source and no invitation (the provenance trigger stamped LEGACY_BACKFILL) and failed on
    -- the one-open-membership index for anybody who had already asked to join. admit_club_member is the
    -- path every other entrance uses: it approves a waiting membership, keeps an active one, and records
    -- INVITATION with this invitation as the source -- under the club's people lock, as every other
    -- admission is.
    perform internal.lock_club_people(v.club_id);

    -- A DEACTIVATED MEMBERSHIP IS NOT RESURRECTED BY AN INVITATION. Refused by RETURNING, which is this
    -- function's contract (a raise would roll back the attempt record and the rate limit with it), and
    -- before anything is written, so the invitation is left usable once the club has deliberately
    -- reactivated them -- the same rule the governing-body branch below keeps for a suspended officer.
    if exists (select 1 from public.club_memberships m
                where m.club_id = v.club_id and m.user_id = v_actor and m.state = 'SUSPENDED') then
      perform internal.invitation_refused(v.id, 'membership_deactivated');
      return jsonb_build_object('outcome','REFUSED','reason','ORGANISATION_ACCESS_SUSPENDED',
        'message','Your membership of this club is deactivated. The club must reactivate it before you can accept an invitation.');
    end if;

    v_membership := internal.admit_club_member(v.club_id, v_actor, 'INVITATION', 'accepted invitation ' || v.id::text, v.id, null);

    -- What is given at the club, as the invitation stored it. An invitation issued before club roles
    -- were stored apart falls back to the old reading, which was correct while nothing club-or-team
    -- could be named at a team.
    v_club_roles := case when v.intended_outcome ? 'club_roles'
                         then coalesce(array(select jsonb_array_elements_text(v.intended_outcome->'club_roles')), '{}')
                         else coalesce(array(select r from unnest(v_roles) r where not internal.role_is_team_scoped(r)), '{}') end;

    -- CLUB ACCESS IS RAISED, NEVER LOWERED. One seat, through the canonical swap: an invitation to a
    -- Club Admin who already holds Club Admin, or to a Fixture Secretary offered Member, changes nothing,
    -- because accepting an invitation must never take authority away.
    v_seat := (select r from unnest(v_club_roles) r where r in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')
                order by case r when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 else 3 end limit 1);
    v_held := (select ra.role_key from public.role_assignments ra
                where ra.membership_id = v_membership and ra.team_id is null and ra.state = 'ACTIVE'
                  and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')
                order by case ra.role_key when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 else 3 end limit 1);
    if v_seat is not null
       and (case v_seat when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 else 3 end)
           < (case v_held when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 when 'MEMBER' then 3 else 4 end) then
      perform internal.apply_primary_club_role(v_membership,
        case v_seat when 'FIXTURES_SECRETARY' then 'FIXTURE_SECRETARY' when 'MEMBER' then 'BASIC_USER' else v_seat end,
        'INVITATION', 'accepted invitation ' || v.id::text, false);
    end if;

    foreach v_role in array v_club_roles loop
      if v_role not in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') then
        perform internal.grant_role(v_membership, v_role, null, 'INVITATION',
                                    'accepted invitation ' || v.id::text);
      end if;
    end loop;

    -- Each team's roles, each carrying the title the club gave it ("Physio" on a First Aider). A role
    -- the person already holds keeps its own title: grant_role returns the existing assignment as it is.
    for v_team, v_team_roles, v_titles in
      select (t->>'id')::uuid, array(select jsonb_array_elements_text(t->'roles')), coalesce(t->'titles', '{}'::jsonb)
        from jsonb_array_elements(v_teams) t
    loop
      foreach v_role in array v_team_roles loop
        perform internal.grant_role(v_membership, v_role, v_team, 'INVITATION',
                                    'accepted invitation ' || v.id::text,
                                    case when internal.team_title_value(v_role, v_titles->>v_role) is null then '{}'::jsonb
                                         else jsonb_build_object('staff_title', internal.team_title_value(v_role, v_titles->>v_role)) end);
      end loop;
    end loop;

    -- What they do at the club, in the words the invitation used, unless the club already says.
    v_declared := nullif(btrim(regexp_replace(coalesce(v.intended_outcome->>'declared_role', ''), '\s+', ' ', 'g')), '');
    if v_declared is not null and length(v_declared) <= 80 and internal.descriptive_title_ok(v_declared) then
      v_prev := internal.membership_sync_on();
      update public.club_memberships set governance_title = v_declared
       where id = v_membership and governance_title is null;
      perform internal.membership_sync_restore(v_prev);
    end if;
    v_result := jsonb_build_object('outcome','MEMBERSHIP_ACTIVE','membership_id',v_membership,
                                   'roles',to_jsonb(v_roles),'teams',v_teams);

  elsif v.kind = 'SAFEGUARDING_OFFICER' then
    -- D-S4-2: Slice 5 owns the email-bound entry, 4G owns the state machine. Admit the person, then
    -- enter the one state machine -- which is the shape 4G said Slice 5 inherits, and the reason an
    -- EXTERNAL nominee can accept at all. Requiring a membership first would have made the
    -- email-bound invitation useful only to people who did not need it.
    v_officer := v.intended_outcome->>'officer_id';
    perform internal.lock_club_people(v.club_id);
    v_membership := internal.admit_club_member(v.club_id, v_actor, 'SAFEGUARDING_APPOINTMENT', null, null, null);

    if v_officer is not null then
      update public.club_safeguarding_officers
         set user_id = v_actor, status = 'active', activated_at = now(),
             updated_by = v_actor, updated_at = now()
       where id = v_officer::uuid;
    end if;

    -- The officer record says active; the AUTHORITY does not. enter_safeguarding_nomination forces
    -- PENDING_CONFIRMATION whoever calls it, so this is a contact record that has been claimed and an
    -- appointment still waiting on Ovalball (AN-6).
    v_id := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>'officer_type','primary'),
      'SAFEGUARDING_APPOINTMENT', v.id, 'accepted invitation',
      case when v_officer is null then null else v_officer::uuid end);

    insert into public.notifications (user_id, type, title, body, data)
    values (v.issued_by, 'safeguarding_officer_invitation_accepted',
            'Safeguarding Officer invitation accepted',
            format('Your Safeguarding Officer invitation for %s was accepted. Ovalball must confirm the appointment before it grants anything.',
                   v.invited_email_normalised),
            jsonb_build_object('officer_id', v_officer, 'invitation_id', v.id));

    v_result := jsonb_build_object('outcome','PENDING_CONFIRMATION','assignment_id',v_id,
                                   'membership_id',v_membership);

  elsif v.kind = 'TEAM_JOIN_CODE' then
    -- L14: a code never grants access. It produces a REQUEST somebody with authority must decide.
    insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status, source_invitation_id)
    values (v.club_id, v_actor, 'BASIC_USER', 'pending', v.id)
    on conflict do nothing;
    v_result := jsonb_build_object('outcome','JOIN_REQUEST_PENDING','club_id',v.club_id,'team_id',v.team_id);

  elsif v.kind = 'SITE_ADMIN' then
    perform internal.apply_site_admin_grant(
      v_actor, internal.site_profile_for_admin_role(coalesce(v.intended_outcome->>'admin_role','read_only')));
    v_result := jsonb_build_object('outcome','SITE_ADMIN_ACTIVE');

  elsif v.kind = 'ACCOUNT_SETUP' then
    -- The identity is confirmed here; the password and MFA setup itself is Slice 6.
    v_result := jsonb_build_object('outcome','ACCOUNT_SETUP_CONFIRMED','user_id',v_actor);

  elsif v.kind = 'PLAYER_ACCOUNT' then
    -- One account is one person. Linking an account that is already somebody, or a player who
    -- already has a login, would merge two identities -- so both refuse, and neither spends the
    -- invitation, because the person can be told what is wrong and it can still be used after.
    if not internal.can('player.account.link', 'self', null, null, null)
       or exists (select 1 from public.players pl where pl.user_id = v_actor)
       or exists (select 1 from public.players pl where pl.id = v.player_id and pl.user_id is not null) then
      perform internal.invitation_refused(v.id, 'player_account_link_unavailable');
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;
    update public.players set user_id = v_actor where id = v.player_id;
    v_result := jsonb_build_object('outcome','ACCEPTED','kind',v.kind,'club_id',v.club_id,
                                   'team_id',v.team_id,'player_id',v.player_id);

  -- CONVERGENCE STEP 16 -- A GOVERNING BODY OFFICER.
  --
  -- SERVER-AUTHORED, like every other outcome here: the role comes from the invitation the
  -- administrator fixed, never from anything the redeemer sends. The organisation comes from the
  -- invitation's own column, and the address was already matched against this session's CONFIRMED
  -- email at step 6, so a link forwarded to somebody else cannot be redeemed by them.
  elsif v.kind = 'GOVERNING_BODY_OFFICER' then
    -- A SUSPENSION IS NOT LIFTED BY ACCEPTING AN INVITATION.
    --
    -- The upsert below sets state = 'ACTIVE', and its conflict target is `state <> 'REVOKED'` -- so it
    -- matches a SUSPENDED row as readily as an ACTIVE one. Accepting an invitation therefore used to
    -- reinstate suspended authority as a side effect, and raise the role while doing it: measured, a
    -- SUSPENDED BODY_COMPETITIONS officer redeemed and came back as an ACTIVE BODY_ADMIN.
    --
    -- That contradicts the rule this platform states for the club role machine, where suspended
    -- authority survives even a full club reactivation: "reactivate_club() deliberately does NOT clear
    -- it -- only restore_club_membership_authority(), one membership at a time, does ... data returns,
    -- privileged authority does not silently return with it." A governing body is a smaller
    -- organisation, not a laxer one.
    --
    -- REFUSED BY RETURNING, NOT BY RAISING, which is this function's contract (IN-K1/IN-K2): a raise
    -- rolls back the attempt record and defeats the redemption rate limits. The reason is specific
    -- rather than the generic message because identity was already established at step 6 -- this is the
    -- invited person, being told something they need and can act on, exactly as
    -- AGE_ELIGIBILITY_REQUIRED is. The invitation is left ISSUED, so it still works once an
    -- administrator has deliberately restored them.
    --
    -- Nothing writes SUSPENDED today -- it is vocabulary the table and the People page carry, and no
    -- control sets it -- so this closes the path before it is reachable rather than after.
    if exists (select 1 from public.constituent_body_roles r
                where r.constituent_body_id = v.constituent_body_id
                  and r.user_id = v_actor and r.state = 'SUSPENDED') then
      perform internal.invitation_refused(v.id, 'organisation_access_suspended');
      return jsonb_build_object('outcome','REFUSED','reason','ORGANISATION_ACCESS_SUSPENDED',
        'message','Your access to this organisation is suspended. An administrator there must restore it before you can accept an invitation.');
    end if;
    insert into public.constituent_body_roles (constituent_body_id, user_id, role_key, granted_by, reason)
    values (v.constituent_body_id, v_actor, v.intended_outcome->>'role_key', v.issued_by,
            'Accepted an invitation to this organisation')
    on conflict (constituent_body_id, user_id) where state <> 'REVOKED'
    do update set role_key = excluded.role_key, state = 'ACTIVE', updated_at = now()
    returning id into v_id;
    v_result := jsonb_build_object('outcome','BODY_ROLE_ACTIVE','role_id',v_id,
      'constituent_body_id',v.constituent_body_id,'role_key',v.intended_outcome->>'role_key');

  elsif v.kind in ('GUARDIAN','CLUB_REFERRAL') then
    v_result := jsonb_build_object('outcome','ACCEPTED','kind',v.kind,'club_id',v.club_id,
                                   'team_id',v.team_id,'player_id',v.player_id);
  end if;

  -- Step 11. Consumption, only now that the outcome has actually been applied.
  insert into public.invitation_redemptions (invitation_id, user_id, result_ref) values (v.id, v_actor, v_result);
  update public.access_invitations
     set use_count = use_count + 1,
         state = case when use_count + 1 >= max_uses then 'REDEEMED' else state end,
         redeemed_by = case when max_uses = 1 then v_actor else redeemed_by end,
         redeemed_at = case when max_uses = 1 then now() else redeemed_at end,
         updated_at = now()
   where id = v.id;

  perform internal.invitation_refused(v.id, 'redeemed');
  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.redeemed', v_actor, v.club_id, v.team_id, 'invitation redeemed',
          jsonb_build_object('invitation_id', v.id, 'kind', v.kind));

  return v_result || jsonb_build_object('invitation_id', v.id, 'kind', v.kind);
end $function$;
-- -----------------------------------------------------------------------------------------------------
-- 8. ONE REGISTER
--
-- club_people was the club's members, their legacy team "seat" (Team Admin / Manager / Coach only, one
-- per team, through the old projection) and the staff invitations' free-text role. It is now the
-- register the owner described: who belongs, what they do, which teams, what access, who is waiting.
--
--   * PLAYERS are rows -- to the people who may already read every roster at the club (team.roster.view
--     at club: Club Admin, Safeguarding Officer; site support). A Fixture Secretary sees the members as
--     before and no player. A player whose own account is a member here is ONE row, the member's, with
--     their teams on it: one person is never two rows.
--   * TEAM ROLES are every team role held (First Aider, Team Safeguarding Lead and a team Volunteer were
--     invisible), each with its label and title; the old keys (id, team_id, team_display_name,
--     permission) stay on each entry for the readers that use them.
--   * ACCESS is the canonical seat key (CLUB_ADMIN / FIXTURES_SECRETARY / MEMBER) beside the legacy
--     `role`, and the club title (governance_title) is returned.
--   * AN INVITATION SHOWS ITS REAL OFFER -- the club-wide roles and each team's roles and titles it will
--     grant -- rather than the free-text role it was labelled with, and who sent it and when. A personal
--     invitation to a player (a single-use team code with a name) is listed to the same roster readers.
--   * FILTERS: all | players | staff | admins | pending | deactivated. "Deactivated" is a lifecycle state
--     and is not mixed into All; a search still finds them. The legacy words staff/members/suspended/
--     invited keep working ("suspended" is "deactivated").
--   * p_role_key / p_title narrow to the holders of one role or one title -- what Access Control opens.
--
-- Return shape changed, so it is dropped and created; the old six-argument call still resolves.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.club_people(uuid, text, text, integer, integer, uuid);

create function public.club_people(
  p_club_id uuid,
  p_search text default null,
  p_filter text default 'all',
  p_limit integer default 50,
  p_offset integer default 0,
  p_membership_id uuid default null,
  p_role_key text default null,
  p_title text default null)
returns table(
  kind text,
  membership_id uuid,
  user_id uuid,
  player_id uuid,
  first_name text,
  surname text,
  email text,
  avatar_storage_path text,
  role text,
  access text,
  state text,
  suspended_level text,
  since timestamptz,
  governance_title text,
  team_roles jsonb,
  additional_roles jsonb,
  player_teams jsonb,
  invitation_id uuid,
  invitation_kind text,
  invitation_email text,
  invitation_role text,
  invitation_name text,
  invitation_offer jsonb,
  invited_by_name text,
  invitation_sent_at timestamptz,
  invitation_expires_at timestamptz,
  is_self boolean,
  total_count bigint)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_contact boolean;
  v_players boolean;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := coalesce(nullif(btrim(p_filter), ''), 'all');
  v_role text := nullif(btrim(coalesce(p_role_key, '')), '');
  v_title text := lower(nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_club_id is null then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if not (internal.can('people.member.view', 'club', p_club_id, null, null) or internal.has_site_capability('site.support.act_in_club')) then
    raise exception 'You do not have permission to see this club''s people.' using errcode = '42501';
  end if;
  v_filter := case v_filter when 'suspended' then 'deactivated' else v_filter end;
  if v_filter not in ('all', 'players', 'staff', 'admins', 'pending', 'deactivated', 'members', 'invited') then
    raise exception 'Unknown people filter.' using errcode = '22023';
  end if;
  v_contact := internal.can('people.member.view_contact', 'club', p_club_id, null, null) or internal.has_site_capability('site.support.act_in_club');
  v_players := internal.can('team.roster.view', 'club', p_club_id, null, null) or internal.has_site_capability('site.support.act_in_club');

  return query
  with placed as (
    -- Every player with a place, or waiting for one, in this club's teams.
    select pl.id as pid, pl.user_id as puser, pl.first_name as pfirst, pl.surname as psurname, pl.avatar_storage_path as pavatar,
           jsonb_agg(jsonb_build_object('team_id', t.id, 'team_display_name', t.display_name, 'state', ptm.state)
                     order by (ptm.state = 'ACTIVE') desc, t.display_name) as pteams,
           bool_or(ptm.state = 'ACTIVE') as pactive,
           min(coalesce(ptm.joined_at, ptm.created_at)) as psince
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
      join public.players pl on pl.id = ptm.player_id
     where v_players and ptm.state in ('ACTIVE', 'PENDING')
     group by pl.id, pl.user_id, pl.first_name, pl.surname, pl.avatar_storage_path
  ),
  members as (
    select
      'member'::text as kind,
      m.id as membership_id,
      m.user_id,
      pc.pid as player_id,
      p.first_name,
      p.surname,
      case when v_contact then p.email else null end as email,
      p.avatar_storage_path,
      m.role,
      seat.role_key as access,
      m.state,
      m.suspended_level,
      m.created_at as since,
      m.governance_title,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', ra.id, 'team_id', ra.team_id, 'team_display_name', t.display_name,
                 'permission', internal.team_role_wire_value(ra.role_key),
                 'role_key', ra.role_key, 'label', rd.label, 'title', ra.attributes ->> 'staff_title', 'state', ra.state)
               order by t.display_name, case ra.role_key when 'TEAM_ADMINISTRATION' then 1 when 'TEAM_MANAGER' then 2 when 'COACH' then 3 else 4 end, rd.label)
          from public.role_assignments ra
          join public.role_definitions rd on rd.role_key = ra.role_key
          join public.teams t on t.id = ra.team_id
         where ra.membership_id = m.id and ra.team_id is not null and ra.state in ('ACTIVE', 'SUSPENDED')
      ), '[]'::jsonb) as team_roles,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', ra.id, 'role_key', ra.role_key, 'label', rd.label, 'state', ra.state, 'confirmation_state', ra.confirmation_state) order by rd.label)
          from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key
         where ra.membership_id = m.id and ra.team_id is null and ra.state in ('ACTIVE', 'SUSPENDED')
           and not rd.is_primary_seat
      ), '[]'::jsonb) as additional_roles,
      coalesce(pc.pteams, '[]'::jsonb) as player_teams,
      null::uuid as invitation_id,
      null::text as invitation_kind,
      null::text as invitation_email,
      null::text as invitation_role,
      null::text as invitation_name,
      null::jsonb as invitation_offer,
      null::text as invited_by_name,
      null::timestamptz as invitation_sent_at,
      null::timestamptz as invitation_expires_at,
      (m.user_id = auth.uid()) as is_self,
      -- WHAT THEY DO: any role beside the seat, at the club or a team, or a title the club gave them.
      (exists (select 1 from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key
                where ra.membership_id = m.id and ra.state = 'ACTIVE' and not rd.is_primary_seat)
        or m.governance_title is not null) as is_staff,
      (seat.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY')) as is_admin,
      (pc.pid is not null) as is_player
    from public.club_memberships m
    join public.profiles p on p.id = m.user_id
    left join lateral (
      select ra.role_key from public.role_assignments ra
       where ra.membership_id = m.id and ra.team_id is null and ra.state in ('ACTIVE', 'SUSPENDED')
         and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')
       order by case ra.role_key when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 else 3 end
       limit 1) seat on true
    left join lateral (select pl.pid, pl.pteams from placed pl where pl.puser = m.user_id limit 1) pc on true
    where m.club_id = p_club_id
      and m.state in ('ACTIVE', 'SUSPENDED', 'PENDING')
      and (p_membership_id is null or m.id = p_membership_id)
  ),
  players as (
    select
      'player'::text, null::uuid, null::uuid, pl.pid, pl.pfirst, pl.psurname, null::text, pl.pavatar,
      null::text, null::text, case when pl.pactive then 'ACTIVE' else 'PENDING' end, null::text, pl.psince, null::text,
      '[]'::jsonb, '[]'::jsonb, pl.pteams,
      null::uuid, null::text, null::text, null::text, null::text, null::jsonb, null::text, null::timestamptz, null::timestamptz,
      (pl.puser is not null and pl.puser = auth.uid()), false, false, true
    from placed pl
    where p_membership_id is null
      and not exists (select 1 from public.club_memberships m
                       where m.club_id = p_club_id and m.user_id = pl.puser and m.state in ('ACTIVE', 'SUSPENDED', 'PENDING'))
  ),
  invited as (
    select
      'invited'::text, null::uuid, null::uuid, null::uuid, null::text, null::text, null::text, null::text,
      null::text, null::text, 'INVITED'::text, null::text, i.created_at, null::text,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      i.id,
      i.kind,
      case when i.invited_email_normalised is null then null
           when v_contact then i.invited_email_normalised
           else regexp_replace(i.invited_email_normalised, '^(.).*(@.*)$', '\1…\2') end,
      coalesce(i.intended_outcome ->> 'declared_role', i.intended_outcome ->> 'role_key', i.intended_outcome ->> 'club_role'),
      nullif(btrim(i.intended_outcome ->> 'invitee_name'), ''),
      case when i.kind = 'CLUB_STAFF' then jsonb_build_object(
             'club_roles', coalesce(i.intended_outcome -> 'club_roles',
                                    (select coalesce(jsonb_agg(r), '[]'::jsonb) from jsonb_array_elements_text(i.intended_outcome -> 'roles') r
                                      where not internal.role_is_team_scoped(r))),
             'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'team_display_name', t.display_name,
                                                                    'roles', e -> 'roles', 'titles', coalesce(e -> 'titles', '{}'::jsonb))
                                                 order by t.display_name)
                                  from jsonb_array_elements(coalesce(i.intended_outcome -> 'teams', '[]'::jsonb)) e
                                  join public.teams t on t.id = (e ->> 'id')::uuid), '[]'::jsonb))
           else jsonb_build_object('audience', coalesce(i.intended_outcome ->> 'audience', 'PLAYER'),
             'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'team_display_name', t.display_name))
                                  from public.teams t where t.id = i.team_id), '[]'::jsonb)) end,
      (select nullif(btrim(concat_ws(' ', ip.first_name, ip.surname)), '') from public.profiles ip where ip.id = i.issued_by),
      coalesce(i.last_sent_at, i.created_at),
      i.expires_at,
      false,
      (i.kind = 'CLUB_STAFF'),
      false,
      (i.kind = 'TEAM_JOIN_CODE')
    from public.access_invitations i
    where i.club_id = p_club_id and i.state = 'ISSUED'
      and (i.expires_at is null or i.expires_at > now()) and i.use_count < i.max_uses
      and p_membership_id is null
      and (i.kind = 'CLUB_STAFF'
           or (v_players and i.kind = 'TEAM_JOIN_CODE' and i.max_uses = 1
               and nullif(btrim(i.intended_outcome ->> 'invitee_name'), '') is not null))
  ),
  rows_all as (
    select * from members
    union all
    select * from players
    union all
    select * from invited
  ),
  filtered as (
    select r.*
      from rows_all r
     where (case v_filter
              when 'all' then r.state <> 'SUSPENDED' or v_search is not null or p_membership_id is not null
                              or v_role is not null or v_title is not null
              when 'players' then r.is_player and r.state <> 'SUSPENDED'
              when 'staff' then r.kind = 'member' and r.is_staff and r.state <> 'SUSPENDED'
              when 'admins' then r.kind = 'member' and r.is_admin and r.state <> 'SUSPENDED'
              when 'pending' then r.state in ('PENDING', 'INVITED')
              when 'deactivated' then r.state = 'SUSPENDED'
              when 'members' then r.kind = 'member' and not r.is_staff and not r.is_admin
              when 'invited' then r.kind = 'invited'
            end)
       and (v_role is null
            or (v_role in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') and r.kind = 'member' and r.access = v_role and r.state = 'ACTIVE')
            or (v_role not in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') and r.kind = 'member' and r.state = 'ACTIVE'
                and exists (select 1 from public.role_assignments ra
                             where ra.membership_id = r.membership_id and ra.role_key = v_role and ra.state = 'ACTIVE')))
       and (v_title is null
            or (r.kind = 'member' and r.state = 'ACTIVE'
                and (lower(r.governance_title) = v_title
                     or exists (select 1 from public.role_assignments ra
                                 where ra.membership_id = r.membership_id and ra.team_id is not null and ra.state = 'ACTIVE'
                                   and lower(replace(ra.attributes ->> 'staff_title', '_', ' ')) = v_title))))
       and (v_search is null
            or (coalesce(r.first_name, '') || ' ' || coalesce(r.surname, '')) ilike '%' || v_search || '%'
            or coalesce(r.invitation_name, '') ilike '%' || v_search || '%'
            or (v_contact and r.email ilike '%' || v_search || '%')
            or (v_contact and r.invitation_email ilike '%' || v_search || '%'))
  )
  select f.kind, f.membership_id, f.user_id, f.player_id, f.first_name, f.surname, f.email, f.avatar_storage_path,
         f.role, f.access, f.state, f.suspended_level, f.since, f.governance_title, f.team_roles, f.additional_roles,
         f.player_teams, f.invitation_id, f.invitation_kind, f.invitation_email, f.invitation_role, f.invitation_name,
         f.invitation_offer, f.invited_by_name, f.invitation_sent_at, f.invitation_expires_at, f.is_self,
         count(*) over () as total_count
    from filtered f
   order by
     case f.state when 'PENDING' then 0 when 'INVITED' then 1 when 'SUSPENDED' then 3 else 2 end,
     lower(coalesce(f.surname, f.invitation_name, f.invitation_email, '')), lower(coalesce(f.first_name, '')),
     f.membership_id, f.player_id, f.invitation_id
   limit v_limit offset v_offset;
end;
$$;
revoke all on function public.club_people(uuid, text, text, integer, integer, uuid, text, text) from public, anon;
grant execute on function public.club_people(uuid, text, text, integer, integer, uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 9. WHO HOLDS WHAT, IN ONE READ (Access Control)
--
-- The counts a register page cannot give without reading every row: how many people hold each level
-- of club access, each club role, each team role and each title in use, and how many are waiting,
-- invited or deactivated. Same gate as the register. Every catalogue row is returned, with nought where
-- nobody holds it, so a page never has to guess a role exists.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.club_access_summary(p_club_id uuid)
returns table(section text, item_key text, label text, people bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_players boolean;
begin
  if p_club_id is null then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if not (internal.can('people.member.view', 'club', p_club_id, null, null) or internal.has_site_capability('site.support.act_in_club')) then
    raise exception 'You do not have permission to see this club''s people.' using errcode = '42501';
  end if;
  v_players := internal.can('team.roster.view', 'club', p_club_id, null, null) or internal.has_site_capability('site.support.act_in_club');

  return query
  with held as (
    select ra.user_id, ra.team_id, ra.role_key, ra.confirmation_state, ra.attributes ->> 'staff_title' as staff_title
      from public.role_assignments ra
      join public.club_memberships m on m.id = ra.membership_id and m.state = 'ACTIVE'
     where ra.club_id = p_club_id and ra.state = 'ACTIVE'
  )
  -- CLUB ACCESS: the one seat every active member holds, and the appointed (confirmed) Safeguarding Officer.
  select 'club_access'::text, rd.role_key, rd.label,
         (select count(distinct h.user_id) from held h
           where h.team_id is null and h.role_key = rd.role_key
             and (rd.role_key <> 'SAFEGUARDING_OFFICER' or h.confirmation_state = 'CONFIRMED'))
    from public.role_definitions rd
   where rd.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER', 'SAFEGUARDING_OFFICER')
  union all
  -- CLUB ROLES: what people do for the club -- Volunteer, and the titles the club has given.
  select 'club_role', rd.role_key, rd.label,
         (select count(distinct h.user_id) from held h where h.team_id is null and h.role_key = rd.role_key)
    from public.role_definitions rd
   where rd.role_key = 'VOLUNTEER'
  union all
  select 'club_title', min(m.governance_title), min(m.governance_title), count(*)
    from public.club_memberships m
   where m.club_id = p_club_id and m.state = 'ACTIVE' and m.governance_title is not null
   group by lower(m.governance_title)
  union all
  -- TEAM ROLES: what people do for a team, each person counted once however many teams.
  select 'team_role', rd.role_key, rd.label,
         (select count(distinct h.user_id) from held h where h.team_id is not null and h.role_key = rd.role_key)
    from public.role_definitions rd
   where rd.role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION', 'FIRST_AIDER', 'TEAM_SAFEGUARDING_LEAD', 'VOLUNTEER')
  union all
  select 'team_title',
         min(case h.staff_title when 'HEAD_COACH' then 'Head Coach' when 'ASSISTANT_COACH' then 'Assistant Coach' else h.staff_title end),
         min(case h.staff_title when 'HEAD_COACH' then 'Head Coach' when 'ASSISTANT_COACH' then 'Assistant Coach' else h.staff_title end),
         count(distinct h.user_id)
    from held h
   where h.team_id is not null and h.staff_title is not null
   group by lower(replace(h.staff_title, '_', ' '))
  union all
  -- WHO IS WAITING, INVITED OR DEACTIVATED, and how many people and players there are.
  select 'state', 'PENDING_INVITATIONS', 'Pending Invitations',
         (select count(*) from public.access_invitations i
           where i.club_id = p_club_id and i.state = 'ISSUED' and (i.expires_at is null or i.expires_at > now())
             and i.use_count < i.max_uses
             and (i.kind = 'CLUB_STAFF'
                  or (v_players and i.kind = 'TEAM_JOIN_CODE' and i.max_uses = 1
                      and nullif(btrim(i.intended_outcome ->> 'invitee_name'), '') is not null)))
  union all
  select 'state', 'WAITING', 'Waiting for Approval',
         (select count(*) from public.club_memberships m where m.club_id = p_club_id and m.state = 'PENDING')
  union all
  select 'state', 'DEACTIVATED', 'Deactivated',
         (select count(*) from public.club_memberships m where m.club_id = p_club_id and m.state = 'SUSPENDED')
  union all
  select 'state', 'MEMBERS', 'Members',
         (select count(*) from public.club_memberships m where m.club_id = p_club_id and m.state = 'ACTIVE')
  union all
  select 'state', 'PLAYERS', 'Players',
         (select count(distinct ptm.player_id) from public.player_team_memberships ptm
            join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
           where ptm.state = 'ACTIVE')
   where v_players;
end;
$$;
revoke all on function public.club_access_summary(uuid) from public, anon;
grant execute on function public.club_access_summary(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 10. WHO COULD JOIN THIS TEAM'S STAFF
--
-- Adding an existing person to a team's staff searched club_people, which needs people.member.view --
-- a key the Team Admin who may give Coach at their team does not hold -- and the failure was swallowed
-- into an empty list. This is the narrow read that job needs: the club's active members by name, with
-- the roles each already holds at THIS team, for whoever team_people_level says may give a role here.
-- No contact details, no other team, no membership history.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.team_staff_candidates(p_team_id uuid, p_search text default null, p_limit integer default 20)
returns table(membership_id uuid, user_id uuid, first_name text, surname text, avatar_storage_path text, team_roles jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id and t.active;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if internal.team_people_level(v_club, p_team_id) is null then
    raise exception 'You are not authorised to choose this team''s staff.' using errcode = '42501';
  end if;

  return query
  select m.id, m.user_id, p.first_name, p.surname, p.avatar_storage_path,
         coalesce((select jsonb_agg(jsonb_build_object('id', ra.id, 'role_key', ra.role_key, 'label', rd.label,
                                                       'title', ra.attributes ->> 'staff_title') order by rd.label)
                     from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key
                    where ra.membership_id = m.id and ra.team_id = p_team_id and ra.state = 'ACTIVE'), '[]'::jsonb)
    from public.club_memberships m
    join public.profiles p on p.id = m.user_id
   where m.club_id = v_club and m.state = 'ACTIVE'
     and (v_search is null or (coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')) ilike '%' || v_search || '%')
   order by lower(coalesce(p.surname, '')), lower(coalesce(p.first_name, '')), m.id
   limit v_limit;
end;
$$;
revoke all on function public.team_staff_candidates(uuid, text, integer) from public, anon;
grant execute on function public.team_staff_candidates(uuid, text, integer) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 11. WHICH ROLES MAY I GIVE HERE -- at the club, or at one team
--
-- club_assignable_roles answered for the club only (in practice: Volunteer). Given a team it now answers
-- for that team, from the catalogue and the caller's own level there -- the same test assign_role runs --
-- so a picker never offers a role the server would refuse. Team Administration is not offered as a
-- role: it is access added on top of a Coach or Team Manager, given from the person's own record.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.club_assignable_roles(uuid);

create function public.club_assignable_roles(p_club_id uuid, p_team_id uuid default null)
returns table(role_key text, label text, scope text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level text;
begin
  if p_team_id is null then
    return query
    select rd.role_key, rd.label, rd.scope
      from public.role_definitions rd
     where rd.visible
       and 'CLUB' = any (rd.assignable_by)
       and not rd.is_primary_seat
       and rd.role_key <> 'SAFEGUARDING_OFFICER'
       and rd.scope in ('CLUB', 'CLUB_OR_TEAM')
       and internal.can('people.member.view', 'club', p_club_id, null, null)
     order by rd.label;
    return;
  end if;

  if not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id and t.active) then
    return;
  end if;
  v_level := internal.team_people_level(p_club_id, p_team_id);
  if v_level is null then
    return;
  end if;
  return query
  select rd.role_key, rd.label, rd.scope
    from public.role_definitions rd
   where rd.visible
     and rd.scope in ('TEAM', 'CLUB_OR_TEAM')
     and v_level = any (rd.assignable_by)
   order by case rd.role_key when 'COACH' then 1 when 'TEAM_MANAGER' then 2 when 'FIRST_AIDER' then 3
                             when 'TEAM_SAFEGUARDING_LEAD' then 4 else 5 end, rd.label;
end;
$$;
revoke all on function public.club_assignable_roles(uuid, uuid) from public, anon;
grant execute on function public.club_assignable_roles(uuid, uuid) to authenticated;

-- The staff invitation's own picker: the ceiling, now saying which roles may also be named at a team.
drop function if exists public.invitation_staff_role_options();

create function public.invitation_staff_role_options()
returns table(role_key text, label text, held_at_team boolean, allowed_at_team boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select rd.role_key, rd.label, rd.scope = 'TEAM', rd.scope in ('TEAM', 'CLUB_OR_TEAM')
    from public.role_definitions rd
   where rd.role_key = any (internal.invitation_club_staff_ceiling())
     and rd.visible
   order by (rd.scope = 'TEAM'), rd.label;
$$;
revoke all on function public.invitation_staff_role_options() from public, anon;
grant execute on function public.invitation_staff_role_options() to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 12. WHAT THE PERSON HOLDING THE LINK IS BEING OFFERED
--
-- The acceptance screen could say "Under 12 Boys at Ovalball UAT RUFC" and who sent it, and nothing of
-- what accepting would make them. It now has the club and team names, the club's crest path (the one
-- logo rule: the club's own upload, else the directory's) and, for a staff invitation, the roles and
-- titles it will grant. Still no email, and still an empty answer for a link that matches nothing.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.preview_invitation(text, text);

create function public.preview_invitation(p_token text default null, p_code text default null)
returns table(kind text, scope_label text, inviter_label text, expires_at timestamptz, state text,
              club_name text, team_name text, crest_path text, offer jsonb)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare v record;
begin
  if coalesce(p_token, p_code) is null then
    raise exception 'Give a link or a code.' using errcode = '22023';
  end if;
  select i.* into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1;
  if v.id is null then
    return;  -- an empty result, not an error: a probe learns nothing from the shape of the answer
  end if;
  return query
    select v.kind,
           coalesce((select t.display_name || ' at ' || d.name
                       from public.teams t join public.clubs c on c.id = t.club_id
                       join public.club_directory d on d.id = c.directory_id where t.id = v.team_id),
                    (select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v.club_id),
                    (select d.name from public.club_directory d where d.id = v.club_directory_id),
                    (select b.canonical_name from public.constituent_bodies b where b.id = v.constituent_body_id),
                    'Ovalball'),
           coalesce((select p.first_name || ' ' || p.surname from public.profiles p where p.id = v.issued_by), 'Ovalball'),
           v.expires_at,
           case when v.state <> 'ISSUED' then lower(v.state)
                when v.expires_at <= now() then 'expired'
                when v.use_count >= v.max_uses then 'used'
                else 'usable' end,
           (select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v.club_id),
           (select t.display_name from public.teams t where t.id = v.team_id),
           (select coalesce(c.logo_storage_path, d.logo_storage_path)
              from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v.club_id),
           -- THE OFFER ONLY WHILE IT CAN BE TAKEN UP. A withdrawn, expired or used link -- a poster still on
           -- a noticeboard -- says that it no longer works, and no longer what it would have given.
           case when v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses then '{}'::jsonb
           else case v.kind
             when 'CLUB_STAFF' then jsonb_build_object(
               'club_roles', coalesce(v.intended_outcome -> 'club_roles',
                                      (select coalesce(jsonb_agg(r), '[]'::jsonb) from jsonb_array_elements_text(v.intended_outcome -> 'roles') r
                                        where not internal.role_is_team_scoped(r))),
               'teams', coalesce((select jsonb_agg(jsonb_build_object('team_display_name', t.display_name,
                                                                      'roles', e -> 'roles', 'titles', coalesce(e -> 'titles', '{}'::jsonb))
                                                   order by t.display_name)
                                    from jsonb_array_elements(coalesce(v.intended_outcome -> 'teams', '[]'::jsonb)) e
                                    join public.teams t on t.id = (e ->> 'id')::uuid), '[]'::jsonb),
               'title', v.intended_outcome ->> 'declared_role')
             when 'TEAM_JOIN_CODE' then jsonb_build_object('audience', v.intended_outcome ->> 'audience')
             else '{}'::jsonb
           end end;
end $$;
revoke all on function public.preview_invitation(text, text) from public;
grant execute on function public.preview_invitation(text, text) to anon, authenticated;

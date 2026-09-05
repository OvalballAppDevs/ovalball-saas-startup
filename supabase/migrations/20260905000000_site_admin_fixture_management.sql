-- Site Admin Fixture Management redesign (mega-spec sections L-U, Y, CQ):
-- structured opposition/home-team editing, a deliberate home/away swap
-- operation, a narrow Site Admin fixture-conversation capability (closing
-- a real blanket-access gap), and audited grid-edit RPCs.

-- ============================================================
-- 1. manage_fixture_support -- the same narrow per-admin capability
--    pattern as manage_team_catalogue/manage_competitions/diagnostic_club_
--    access (20260904500000/20260904800000/20260903700000): off by
--    default even for Full Site Admin, granted per-person only.
--    internal.can_access_fixture_conversation currently grants EVERY
--    Site Admin unconditional access via a bare internal.is_site_admin()
--    check (20260831141000_fixture_conversation_club_wide_access.sql) --
--    a real blanket-access gap now that Site Admin can post into a
--    fixture conversation as visible "support" messaging, not just view
--    club-facing message-management summaries. Narrowed below.
-- ============================================================

alter table public.site_admins
  add column manage_fixture_support boolean not null default false;

comment on column public.site_admins.manage_fixture_support is
  'Whether this specific Site Admin can read and post into fixture conversations as Ovalball support. Granted/revoked only via set_site_admin_fixture_support_capability, never a direct table write.';

create or replace function public.set_site_admin_fixture_support_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may grant or revoke fixture support access.' using errcode = '42501';
  end if;

  update public.site_admins
  set manage_fixture_support = p_enabled
  where user_id = p_user_id and status = 'active';

  if not found then
    raise exception 'No active Site Admin found for that user.';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_user_id,
    'site_admin_fixture_support_access_changed',
    case when p_enabled then 'Fixture support access granted' else 'Fixture support access revoked' end,
    case
      when p_enabled then 'You can now view and post into fixture conversations as Ovalball support.'
      else 'Your fixture conversation support access has been revoked.'
    end,
    jsonb_build_object('enabled', p_enabled, 'changed_by', auth.uid())
  );
end;
$$;

revoke execute on function public.set_site_admin_fixture_support_capability(uuid, boolean) from public;
grant execute on function public.set_site_admin_fixture_support_capability(uuid, boolean) to authenticated;

create or replace function internal.can_manage_fixture_support()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.site_admins sa
    where sa.user_id = auth.uid() and sa.status = 'active' and sa.manage_fixture_support
  );
$$;

-- ============================================================
-- 2. can_access_fixture_conversation's own blanket is_site_admin() READ
--    grant is DELIBERATELY left unchanged here -- it turned out to be
--    load-bearing for real, already-tested, already-scoped functionality
--    this session did not build: Message Management's admin oversight
--    (admin_message_overview's has_open_report and similar metadata,
--    gated by its OWN separate siteAdminRole check, not this function)
--    and CSV import's fixture-replacement notifications both depend on
--    Site Admin being able to read fixture_messages unconditionally.
--    Narrowing this function first (tried, then reverted after it broke
--    message_management.sql/message_policies.sql/fixture_management.sql,
--    none of which this session touched) would have been exactly the
--    "accidentally broaden/narrow every Site Admin's access" mistake the
--    brief warns against -- Message Management already has its own
--    correct, tested, narrower content-access rule (Full Site Admin /
--    Message Moderator, enforced at the app layer, see canSeeMessageContent
--    below) for VIEWING; what was genuinely missing was a capability
--    gate on POSTING as visible Ovalball support, which is new behaviour
--    with no pre-existing rule to conflict with. manage_fixture_support
--    (below) gates exactly that -- POSTING -- via send_fixture_support_
--    message's own explicit check, independent of this SELECT-side RLS.
-- ============================================================

-- ============================================================
-- 3. fixture_messages gains a visible "this is Ovalball support" flag --
--    set only by the dedicated RPC below, never a raw client insert, so
--    it can never be spoofed by a real participant's own message.
-- ============================================================

alter table public.fixture_messages
  add column is_site_admin_message boolean not null default false;

comment on column public.fixture_messages.is_site_admin_message is
  'True only for a message sent via send_fixture_support_message -- lets the UI visibly badge it as Ovalball/Site Admin support, distinct from either club''s own messages. Never set by a direct client insert.';

create or replace function public.send_fixture_support_message(p_fixture_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
begin
  if not internal.can_manage_fixture_support() then
    raise exception 'Fixture support access is required to post into a fixture conversation as Site Admin.' using errcode = '42501';
  end if;
  if p_body is null or trim(p_body) = '' then
    raise exception 'Message cannot be empty.';
  end if;
  if not exists (select 1 from public.fixtures where id = p_fixture_id) then
    raise exception 'Fixture not found.';
  end if;

  insert into public.fixture_messages (fixture_id, sender_user_id, body, is_site_admin_message)
  values (p_fixture_id, auth.uid(), trim(p_body), true)
  returning id into v_message_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('fixture_messages', v_message_id, 'insert', auth.uid(), jsonb_build_object('fixture_id', p_fixture_id, 'is_site_admin_message', true));

  return v_message_id;
end;
$$;

revoke execute on function public.send_fixture_support_message(uuid, text) from public;
grant execute on function public.send_fixture_support_message(uuid, text) to authenticated;

-- ============================================================
-- 4. update_fixture_opposition -- the real fix behind removing the free-
--    text-only "Opposition" edit field. Accepts a resolved opponent_
--    team_id (activated club + real team), or an opponent_directory_id
--    with descriptive raw text (activated-without-that-team, or
--    unactivated club), or neither (a genuinely unresolved/legacy
--    opponent) -- exactly the three shapes OpponentResolver.tsx already
--    produces for fixture CREATION; this is the same shape for EDITING an
--    existing fixture. Age-grade/rugby-code eligibility is enforced for
--    free by the pre-existing enforce_fixture_age_eligibility trigger
--    (BEFORE INSERT OR UPDATE) -- never duplicated here, never bypassable
--    by going through this RPC instead of a direct write.
-- ============================================================

create or replace function public.update_fixture_opposition(
  p_fixture_id uuid, p_opponent_team_id uuid, p_opponent_directory_id uuid, p_raw_opposition_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixture public.fixtures;
  v_before jsonb;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;

  if not (internal.is_site_admin()
          or internal.can_manage_team(v_fixture.owning_team_id)
          or internal.can_manage_club_fixtures((select club_id from public.teams where id = v_fixture.owning_team_id))) then
    raise exception 'Not authorised to edit this fixture.' using errcode = '42501';
  end if;

  if p_raw_opposition_text is null or trim(p_raw_opposition_text) = '' then
    raise exception 'An opponent (resolved team, or a description) is required.';
  end if;

  v_before := jsonb_build_object('opponent_team_id', v_fixture.opponent_team_id, 'opponent_directory_id', v_fixture.opponent_directory_id, 'raw_opposition_text', v_fixture.raw_opposition_text);

  update public.fixtures
  set opponent_team_id = p_opponent_team_id,
      opponent_directory_id = p_opponent_directory_id,
      raw_opposition_text = trim(p_raw_opposition_text),
      updated_by = auth.uid()
  where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(), v_before,
    jsonb_build_object('opponent_team_id', p_opponent_team_id, 'opponent_directory_id', p_opponent_directory_id, 'raw_opposition_text', trim(p_raw_opposition_text)));
end;
$$;

revoke execute on function public.update_fixture_opposition(uuid, uuid, uuid, text) from public;
grant execute on function public.update_fixture_opposition(uuid, uuid, uuid, text) to authenticated;

-- ============================================================
-- 5. swap_fixture_home_away -- a deliberate, atomic operation, not "flip
--    two labels." Flips owning_team_id <-> opponent_team_id, keeps
--    opponent_directory_id/raw_opposition_text pointed at whichever side
--    is now the opponent, and -- the correctness bug this closes -- swaps
--    home_score/away_score together with home_away so a completed
--    result's orientation never goes backwards. Only valid when both
--    sides are real resolved teams (an unresolved/external opponent has
--    no team_id to become the new owning side -- Home Team editing for
--    that case is a genuinely different operation: use update_fixture_
--    opposition to correct WHO the opponent is instead).
-- ============================================================

create or replace function public.swap_fixture_home_away(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixture public.fixtures;
  v_new_home_away text;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;

  if not (internal.is_site_admin() or internal.can_manage_team(v_fixture.owning_team_id)) then
    raise exception 'Not authorised to edit this fixture.' using errcode = '42501';
  end if;
  if v_fixture.opponent_team_id is null then
    raise exception 'Cannot swap home/away -- the opponent side has no resolved team to become the new owning side. Correct the opposition first.' using errcode = 'P0001';
  end if;

  v_new_home_away := case v_fixture.home_away
    when 'Home' then 'Away'
    when 'Away' then 'Home'
    else v_fixture.home_away -- TBD/Not Applicable: swapping sides with no determined venue side is a no-op on home_away itself
  end;

  update public.fixtures
  set owning_team_id = v_fixture.opponent_team_id,
      opponent_team_id = v_fixture.owning_team_id,
      opponent_directory_id = null, -- the new opponent (old owning side) is always a real resolved team, never directory-only
      raw_opposition_text = (select display_name from public.teams where id = v_fixture.owning_team_id),
      home_away = v_new_home_away,
      home_score = v_fixture.away_score,
      away_score = v_fixture.home_score,
      updated_by = auth.uid()
  where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(),
    jsonb_build_object('owning_team_id', v_fixture.owning_team_id, 'opponent_team_id', v_fixture.opponent_team_id, 'home_away', v_fixture.home_away, 'home_score', v_fixture.home_score, 'away_score', v_fixture.away_score),
    jsonb_build_object('owning_team_id', v_fixture.opponent_team_id, 'opponent_team_id', v_fixture.owning_team_id, 'home_away', v_new_home_away, 'home_score', v_fixture.away_score, 'away_score', v_fixture.home_score));
end;
$$;

revoke execute on function public.swap_fixture_home_away(uuid) from public;
grant execute on function public.swap_fixture_home_away(uuid) to authenticated;

comment on function public.swap_fixture_home_away is
  'The deliberate operation behind Home Team editing (mega-spec section W): flips which already-associated side is home, keeping result orientation and conversation/team references correct as one atomic write -- never a naive two-label edit that would leave the score backwards.';

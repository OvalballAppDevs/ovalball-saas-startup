-- =====================================================================================================
-- SLICE 4G (2/3) — THREAD VISIBILITY, OVALBALL REVIEW, LIFECYCLE AND DISPENSATIONS
--
-- Design J.12, section T "Lifecycle"/"Contact path"/"Site Admin access"/"Dispensations", AN-9, and
-- audit items AI #68 and #69.
--
-- The two legacy items AA.3 row 4g names, and where they actually live:
--
--   PER-OFFICER OVERRIDE DEPENDENCE.  Who counts as a Safeguarding Officer has been read off
--   club_safeguarding_officers.user_id / status = 'active' -- a row a Club Admin writes -- and thread
--   access off club_safeguarding_officer_conversations.officer_user_id, the person named on the
--   thread. Neither asks whether the appointment was ever confirmed, so after Slice 4G's AN-6 change
--   they would both have granted authority to a nomination Ovalball had not agreed to.
--
--   SITE ADMIN THREAD READ.  internal.can_view_safeguarding_conversation opens with
--   internal.is_site_admin(). Every site-admin profile -- read_only, content, fixture_ops included --
--   can read every safeguarding conversation in Ovalball, silently. Section T says there is no RLS
--   read at all and that Ovalball reaches a thread only through a reasoned RPC that leaves a mark the
--   club can see afterwards. That RPC did not exist. It does now.
-- =====================================================================================================

-- 1. "Reviewed by Ovalball on ..." -------------------------------------------------------------------
-- AI #69 asks for one event per thread opened and AN-9 asks that the club's Safeguarding Officers can
-- see it afterwards. A security event alone cannot do the second half: security_events is not a
-- surface a club officer reads. So the review is recorded where the people it is about can see it.
create table if not exists public.safeguarding_thread_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.club_safeguarding_officer_conversations(id) on delete cascade,
  club_id uuid not null references public.clubs(id),
  reviewed_by uuid not null references auth.users(id),
  reason text not null,
  reviewed_at timestamptz not null default now()
);

create index if not exists safeguarding_thread_reviews_conversation_idx
  on public.safeguarding_thread_reviews (conversation_id, reviewed_at desc);
create index if not exists safeguarding_thread_reviews_club_idx
  on public.safeguarding_thread_reviews (club_id, reviewed_at desc);

alter table public.safeguarding_thread_reviews enable row level security;

-- The club's confirmed, active Safeguarding Officers see that Ovalball looked, and the reviewer sees
-- their own. Nobody else -- not the Club Admin, because a review may be about the Club Admin.
drop policy if exists safeguarding_thread_reviews_select on public.safeguarding_thread_reviews;
create policy safeguarding_thread_reviews_select on public.safeguarding_thread_reviews
  for select to authenticated using (
    reviewed_by = (select auth.uid())
    or (select auth.uid()) = any (internal.active_safeguarding_officer_ids(club_id))
    or (select internal.has_site_capability('site.safeguarding.review'))
  );

revoke all on public.safeguarding_thread_reviews from anon;
grant select on public.safeguarding_thread_reviews to authenticated;

-- 2. Who may read and write a safeguarding thread -----------------------------------------------------
-- J.12 line 544: safeguarding.conversation.handle, SO, "ACTIVE assignment only". The blanket site read
-- is gone; the person who raised the thread keeps it, because a thread you started is yours to read.
create or replace function internal.can_view_safeguarding_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_safeguarding_officer_conversations c
    where c.id = p_conversation_id
      and (
        c.requester_user_id = auth.uid()
        -- The CLUB's confirmed officers, not the one person named on the row. An officer appointed
        -- after a thread was opened still has to be able to deal with it, and one whose appointment
        -- has been revoked must stop being able to -- section T, "deactivated officers lose thread
        -- access the next request".
        or (auth.uid() = any (internal.active_safeguarding_officer_ids(c.club_id))
            and internal.can('safeguarding.conversation.handle', 'club', c.club_id, null, null))
      )
  );
$$;

comment on function internal.can_view_safeguarding_conversation(uuid) is
  'Slice 4G: the person who raised the thread, or a CONFIRMED ACTIVE Safeguarding Officer of that club '
  'holding safeguarding.conversation.handle. No site read: J.12 line 550 routes Ovalball through '
  'public.site_safeguarding_review, which requires a reason and leaves a mark the club can see.';

-- Sending: the officer side is the same question. The requester side was broken and is fixed here --
-- internal.has_capability('club.safeguarding.message', ...) resolved to a key only a Club Admin held,
-- so an ordinary member could OPEN a safeguarding thread and then could not reply in it. J.12 line 545
-- gives safeguarding.conversation.start to members, volunteers, coaches, managers, the secretary, the
-- admin, players of 13 and over and guardians, which is who should be able to speak in their own thread.
create or replace function internal.can_send_safeguarding_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_safeguarding_officer_conversations c
    where c.id = p_conversation_id
      and (
        (c.requester_user_id = auth.uid()
         and internal.can('safeguarding.conversation.start', 'club', c.club_id, null, null))
        or (auth.uid() = any (internal.active_safeguarding_officer_ids(c.club_id))
            and internal.can('safeguarding.conversation.handle', 'club', c.club_id, null, null))
      )
  );
$$;

comment on function internal.can_send_safeguarding_conversation(uuid) is
  'Slice 4G: the requester (safeguarding.conversation.start) in their own thread, or a CONFIRMED ACTIVE '
  'Safeguarding Officer (safeguarding.conversation.handle). Ovalball never writes into a club thread.';

-- 3. Ovalball's way in -------------------------------------------------------------------------------
-- AI #68/#69 and AN-9. Reason required, one event per thread opened, one visible review row, and the
-- content returned rather than the table exposed -- so there is no path that reads a safeguarding
-- thread without leaving a record of who read it and why.
create or replace function public.site_safeguarding_review(p_conversation_id uuid, p_reason text)
returns table (message_id uuid, sender_user_id uuid, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Reading a safeguarding thread needs a reason, and the club is shown it.' using errcode = '22023';
  end if;
  if not internal.has_site_capability('site.safeguarding.review') then
    raise exception 'You are not authorised to review safeguarding conversations.' using errcode = '42501';
  end if;

  select c.club_id into v_club from public.club_safeguarding_officer_conversations c where c.id = p_conversation_id;
  if v_club is null then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  insert into public.safeguarding_thread_reviews (conversation_id, club_id, reviewed_by, reason)
  values (p_conversation_id, v_club, auth.uid(), trim(p_reason));

  perform internal.emit_security_event('safeguarding.thread_reviewed', auth.uid(), 'SUCCESS', trim(p_reason),
    jsonb_build_object('conversation_id', p_conversation_id), v_club, null, null);

  -- The club's officers are told at the time, not only in a list they might look at.
  insert into public.notifications (user_id, type, title, body, data)
  select o, 'safeguarding_thread_reviewed', 'Reviewed by Ovalball',
         'Ovalball opened one of your club''s safeguarding conversations and recorded why.',
         jsonb_build_object('conversation_id', p_conversation_id, 'club_id', v_club)
  from unnest(internal.active_safeguarding_officer_ids(v_club)) o;

  return query
    select m.id, m.sender_user_id, m.body, m.created_at
    from public.fixture_messages m
    where m.safeguarding_conversation_id = p_conversation_id
    order by m.created_at;
end;
$$;

comment on function public.site_safeguarding_review(uuid, text) is
  'AN-9 / AI #68-69 (Slice 4G): the ONLY route by which Ovalball reads a club safeguarding thread. '
  'site.safeguarding.review, a required reason, one safeguarding.thread_reviewed event, a review row '
  'the club''s officers can see, and a notification to each of them. Replaces the blanket RLS read.';

revoke execute on function public.site_safeguarding_review(uuid, text) from public, anon;
grant execute on function public.site_safeguarding_review(uuid, text) to authenticated, service_role;

-- 4. Officer identity for notifications --------------------------------------------------------------
-- The per-officer dependence, retired. This resolver decided who a club's officers were by reading the
-- contact table; it now reads confirmed assignments, so a nomination awaiting AN-6 receives nothing.
create or replace function internal.notify_club_safeguarding_officers(p_club_id uuid, p_capability_key text, p_type text, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select m.capability_key into v_key from public.capability_key_map m where m.legacy_key = p_capability_key and m.legacy_scope = 'club';
  v_key := coalesce(v_key, p_capability_key);
  insert into public.notifications (user_id, type, title, body, data)
  select distinct o, p_type, p_title, p_body, p_data
  from unnest(internal.active_safeguarding_officer_ids(p_club_id)) o
  where (internal.capability_decision(o, v_key, 'club', p_club_id, null, null, false, false)).allowed;
end;
$$;

comment on function internal.notify_club_safeguarding_officers(uuid, text, text, text, text, jsonb) is
  'Slice 4G: notifies the club''s CONFIRMED ACTIVE Safeguarding Officers, from role assignments rather '
  'than the contact table. A nomination still awaiting AN-6 is not an officer and is not told.';

-- 5. The contact path for members --------------------------------------------------------------------
-- J.12 line 542: safeguarding.contact.view reaches CA, SO, FS, VO, MB, CO, TM, players of 13 and over
-- and guardians -- "name, role, contact route only". The legacy key it replaces was Club Admin only
-- and hid the officer from parents, which is close to the opposite of what a safeguarding contact is
-- for. The email address is deliberately still returned: it is the contact route.
create or replace function public.club_safeguarding_contact(p_club_id uuid)
returns table (officer_type text, contact_name text, contact_email text, reachable_on_ovalball boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select o.officer_type, o.contact_name, o.contact_email,
         o.user_id is not null and o.user_id = any (internal.active_safeguarding_officer_ids(p_club_id))
  from public.club_safeguarding_officers o
  where o.club_id = p_club_id and o.status = 'active'
    and internal.can('safeguarding.contact.view', 'club', p_club_id, null, null)
  order by case o.officer_type when 'primary' then 1 else 2 end, o.contact_name;
$$;

comment on function public.club_safeguarding_contact(uuid) is
  'Slice 4G (J.12 line 542): the club''s safeguarding contact card -- name, role and contact route -- '
  'for anyone holding safeguarding.contact.view, which now includes parents and players of 13 and over.';

revoke execute on function public.club_safeguarding_contact(uuid) from public, anon;
grant execute on function public.club_safeguarding_contact(uuid) to authenticated, service_role;

create or replace function public.get_club_safeguarding_officers(p_club_id uuid)
returns table(id uuid, officer_type text, contact_name text, contact_email text, status text, user_id uuid, activated_at timestamptz, pending_invitation_id uuid, pending_invitation_expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id, o.officer_type, o.contact_name, o.contact_email, o.status, o.user_id, o.activated_at,
    i.id, i.expires_at
  from public.club_safeguarding_officers o
  left join public.club_safeguarding_officer_invitations i on i.officer_id = o.id and i.status = 'pending'
  where o.club_id = p_club_id and o.status <> 'inactive'
    and (internal.can('safeguarding.officer.nominate', 'club', p_club_id, null, null)
         or internal.has_site_capability('site.support.view_club')
         or o.user_id = auth.uid())
  order by o.officer_type;
$$;

-- 6. Starting a thread -------------------------------------------------------------------------------
-- J.12 line 545 names this RPC start_safeguarding_conversation and does NOT have the member choose an
-- officer, which is right: a person raising a safeguarding concern should not have to pick which
-- officer to raise it with. The older two-argument entry stays for the existing screen and is
-- canonicalised in place.
create or replace function public.start_safeguarding_conversation(p_club_id uuid, p_first_message text)
returns table (conversation_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officer uuid;
  v_id uuid;
  v_new boolean := false;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can('safeguarding.conversation.start', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to contact this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_message), '') = '' then
    raise exception 'A message is required.' using errcode = '22023';
  end if;

  -- The primary officer where there is one, otherwise whichever confirmed officer the club has. The
  -- thread is readable by all of them regardless (section 2), so this only decides whose name is on it.
  select ra.user_id into v_officer
  from public.role_assignments ra
  join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
  where ra.club_id = p_club_id and ra.role_key = 'SAFEGUARDING_OFFICER'
    and ra.state = 'ACTIVE' and ra.confirmation_state = 'CONFIRMED' and ra.user_id <> auth.uid()
  order by case ra.attributes ->> 'officer_type' when 'primary' then 1 else 2 end, ra.granted_at
  limit 1;

  if v_officer is null then
    raise exception 'This club has no confirmed Safeguarding Officer on Ovalball yet -- use the contact details on the safeguarding page instead.'
      using errcode = '22023';
  end if;

  select c.id into v_id from public.club_safeguarding_officer_conversations c
  where c.club_id = p_club_id and c.requester_user_id = auth.uid() and c.officer_user_id = v_officer;

  if v_id is null then
    insert into public.club_safeguarding_officer_conversations (club_id, requester_user_id, officer_user_id)
    values (p_club_id, auth.uid(), v_officer) returning id into v_id;
    v_new := true;
    insert into public.fixture_messages (safeguarding_conversation_id, sender_user_id, body, kind)
    values (v_id, auth.uid(), trim(p_first_message), 'message');
  end if;

  return query select v_id, v_new;
end;
$$;

comment on function public.start_safeguarding_conversation(uuid, text) is
  'Slice 4G (J.12 line 545): open a safeguarding thread with the club''s confirmed officers. The '
  'caller does not choose an officer -- raising a concern should not require knowing who to raise it with.';

revoke execute on function public.start_safeguarding_conversation(uuid, text) from public, anon;
grant execute on function public.start_safeguarding_conversation(uuid, text) to authenticated, service_role;

-- 7. The officer's own record ------------------------------------------------------------------------
-- J.12 line 546: safeguarding.officer.contact_edit is SE scope, held by the officer over their OWN
-- record. Until now a Club Admin edited it and the officer could not.
create or replace function public.update_safeguarding_officer_contact(p_officer_id uuid, p_contact_name text, p_contact_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officer public.club_safeguarding_officers;
begin
  select * into v_officer from public.club_safeguarding_officers where id = p_officer_id for update;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_email), '') = '' then
    raise exception 'A name and email are both required.' using errcode = '22023';
  end if;

  if not (
    (v_officer.user_id = auth.uid() and internal.can('safeguarding.officer.contact_edit', 'self', null, null, null))
    or internal.can('safeguarding.officer.nominate', 'club', v_officer.club_id, null, null)
  ) then
    raise exception 'You are not authorised to change this Safeguarding Officer record.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officers
  set contact_name = trim(p_contact_name), contact_email = lower(trim(p_contact_email)),
      updated_by = auth.uid(), updated_at = now()
  where id = p_officer_id;
end;
$$;

-- 8. Deactivation, and where the threads go ----------------------------------------------------------
-- Section T "Lifecycle": on deactivation threads transfer to the remaining ACTIVE officers, or, where
-- there are none, to Ovalball's safeguarding queue with notification. Access already follows the club's
-- officer set rather than the name on the row, so this is about the thread having an owner and about
-- somebody being told -- not about quietly leaving orphaned threads nobody is looking at.
create or replace function public.deactivate_safeguarding_officer(p_officer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officer public.club_safeguarding_officers;
  v_row record;
  v_successor uuid;
  v_orphans int := 0;
begin
  select * into v_officer from public.club_safeguarding_officers where id = p_officer_id for update;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.' using errcode = 'P0002';
  end if;
  if not internal.can('safeguarding.officer.deactivate', 'club', v_officer.club_id, null, null) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officers
  set status = 'inactive', deactivated_by = auth.uid(), deactivated_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_officer_id;

  update public.club_safeguarding_officer_invitations
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
  where officer_id = p_officer_id and status = 'pending';

  if v_officer.user_id is not null then
    update public.capability_overrides
    set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), updated_at = now()
    where user_id = v_officer.user_id and scope_type = 'club' and club_id = v_officer.club_id
      and capability_key in ('club.dispensation.view', 'club.dispensation.notify', 'club.transfer.safeguarding_view', 'club.transfer.safeguarding_notify',
                             'safeguarding.dispensation.view', 'safeguarding.dispensation.notify', 'safeguarding.transfer.view', 'safeguarding.transfer.notify')
      and status = 'active';

    for v_row in
      select id from public.role_assignments
      where club_id = v_officer.club_id and user_id = v_officer.user_id and role_key = 'SAFEGUARDING_OFFICER' and state <> 'REVOKED'
        and (attributes ->> 'safeguarding_officer_id' = p_officer_id::text
             or not exists (select 1 from public.club_safeguarding_officers o
                            where o.club_id = v_officer.club_id and o.user_id = v_officer.user_id and o.status = 'active' and o.id <> p_officer_id))
    loop
      perform internal.end_role(v_row.id, 'REVOKED', 'Safeguarding Officer deactivated', null);
    end loop;

    -- THE TRANSFER. Recomputed after the revocation above, so the outgoing officer cannot be chosen
    -- as their own successor.
    select o into v_successor from unnest(internal.active_safeguarding_officer_ids(v_officer.club_id)) o limit 1;

    if v_successor is not null then
      update public.club_safeguarding_officer_conversations
      set officer_user_id = v_successor
      where club_id = v_officer.club_id and officer_user_id = v_officer.user_id;
      insert into public.notifications (user_id, type, title, body, data)
      values (v_successor, 'safeguarding_threads_transferred', 'Safeguarding conversations transferred',
              'Safeguarding conversations have moved to you because an officer was deactivated.',
              jsonb_build_object('club_id', v_officer.club_id));
    else
      select count(*) into v_orphans from public.club_safeguarding_officer_conversations
      where club_id = v_officer.club_id and officer_user_id = v_officer.user_id;
      if v_orphans > 0 then
        perform internal.emit_security_event('safeguarding.threads_unattended', v_officer.user_id, 'SUCCESS',
          'club left with no confirmed Safeguarding Officer',
          jsonb_build_object('club_id', v_officer.club_id, 'conversations', v_orphans), v_officer.club_id, null, null);
        insert into public.notifications (user_id, type, title, body, data)
        select sa.user_id, 'safeguarding_threads_unattended', 'Club has no Safeguarding Officer',
               'A club''s safeguarding conversations have no officer to read them.',
               jsonb_build_object('club_id', v_officer.club_id, 'conversations', v_orphans)
        from public.site_admins sa
        where sa.status = 'active'
          and (internal.capability_decision(sa.user_id, 'site.safeguarding.review', 'site', null, null, null, false, false)).allowed;
      end if;
    end if;
  end if;
end;
$$;

-- 9. Welfare ------------------------------------------------------------------------------------------
-- J.12 line 549: safeguarding.welfare.view, SO, AAL R, "name, team, guardian contact route, consent
-- state" and an event. A Safeguarding Officer looking up a child is a thing that should be recorded.
create or replace function public.welfare_member_view(p_player_id uuid, p_reason text)
returns table (player_name text, team_name text, guardian_name text, guardian_contact text, guardian_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Looking up a member''s welfare record needs a reason, and it is recorded.' using errcode = '22023';
  end if;

  select t.club_id into v_club
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and ptm.state = 'ACTIVE'
  limit 1;
  if v_club is null then
    raise exception 'That player is not in a team at any club.' using errcode = 'P0002';
  end if;
  if not internal.can('safeguarding.welfare.view', 'club', v_club, null, null) then
    raise exception 'You are not authorised to view welfare records for this club.' using errcode = '42501';
  end if;

  perform internal.emit_security_event('safeguarding.welfare_viewed', auth.uid(), 'SUCCESS', trim(p_reason),
    jsonb_build_object('player_id', p_player_id), v_club, null, p_player_id);

  return query
    select btrim(coalesce(pl.first_name,'') || ' ' || coalesce(pl.surname,'')),
           t.display_name,
           btrim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,'')),
           pr.email,
           g.state
    from public.players pl
    left join public.player_team_memberships ptm on ptm.player_id = pl.id and ptm.state = 'ACTIVE'
    left join public.teams t on t.id = ptm.team_id
    left join public.guardians g on g.player_id = pl.id and g.state = 'ACTIVE'
    left join public.profiles pr on pr.id = g.guardian_user_id
    where pl.id = p_player_id;
end;
$$;

comment on function public.welfare_member_view(uuid, text) is
  'Slice 4G (J.12 line 549): a Safeguarding Officer''s welfare lookup -- name, team, guardian contact '
  'route and consent state -- with a required reason and a safeguarding.welfare_viewed event.';

revoke execute on function public.welfare_member_view(uuid, text) from public, anon;
grant execute on function public.welfare_member_view(uuid, text) to authenticated, service_role;

-- 10. The notification types this slice introduces -----------------------------------------------------
-- Registered rather than invented at the call site: notification_destinations asserts that every type
-- a function emits is catalogued. All of these are mandatory -- a person does not opt out of being told
-- that Ovalball read their club's safeguarding thread, or that their child was called up.
insert into public.notification_types (type_key, topic_key, mandatory_override) values
  ('safeguarding_officer_confirmed',    'support_moderation', true),
  ('safeguarding_thread_reviewed',      'support_moderation', true),
  ('safeguarding_threads_transferred',  'support_moderation', true),
  ('safeguarding_threads_unattended',   'support_moderation', true),
  ('safeguarding_guardian_dispensation','support_moderation', true),
  ('safeguarding_guardian_call_up',     'support_moderation', true)
on conflict (type_key) do update set topic_key = excluded.topic_key, mandatory_override = excluded.mandatory_override;

-- 11. Guardians are told about their own child ---------------------------------------------------------
-- Section T "Dispensations": guardians are notified of call-ups and dispensations for their child, and
-- it is a mandatory notification. This is a TRIGGER rather than a line added to the two decision RPCs,
-- for the same reason the sender-identity check is a trigger: it covers every write path, including the
-- ones nobody has written yet, and a safeguarding notification that a future code path forgets to send
-- is exactly the kind that matters.
create or replace function internal.notify_player_guardians_of_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_name text;
  v_type text;
  v_title text;
  v_body text;
begin
  if tg_table_name = 'player_team_dispensation' then
    v_player := new.player_id; v_type := 'safeguarding_guardian_dispensation';
    v_title := 'Age-grade approval update';
    v_body := format('The age-grade approval for %%s is now %s.', new.status);
  else
    v_player := new.player_id; v_type := 'safeguarding_guardian_call_up';
    v_title := 'Call-up update';
    v_body := format('The call-up request for %%s is now %s.', new.status);
  end if;

  select btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.surname,'')) into v_name
  from public.players p where p.id = v_player;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct g.guardian_user_id, v_type, v_title, format(v_body, coalesce(nullif(v_name,''), 'your child')),
         jsonb_build_object('player_id', v_player, 'record_id', new.id, 'status', new.status)
  from public.guardians g
  where g.player_id = v_player and g.state = 'ACTIVE' and g.guardian_user_id is not null;

  return new;
end;
$$;

drop trigger if exists player_team_dispensation_notify_guardians on public.player_team_dispensation;
create trigger player_team_dispensation_notify_guardians
  after update of status on public.player_team_dispensation
  for each row when (old.status is distinct from new.status)
  execute function internal.notify_player_guardians_of_status();

drop trigger if exists fixture_player_call_up_notify_guardians on public.fixture_player_call_up;
create trigger fixture_player_call_up_notify_guardians
  after update of status on public.fixture_player_call_up
  for each row when (old.status is distinct from new.status)
  execute function internal.notify_player_guardians_of_status();

-- 12. Dispensations: separation of duties, and no site bypass -------------------------------------------
-- Section T: "separation of duties -- the requester cannot approve either stage". Nothing enforced that;
-- a Fixtures Secretary who requested a dispensation could approve their own request at the source-team
-- stage, and a Club Admin who requested one could approve it at the club stage.
--
-- internal.is_site_admin() also went, at both stages it appeared in. It let every site-admin profile
-- decide a club's age-grade approval, which is a safeguarding-adjacent decision about a child, without
-- the club being involved. It becomes the canonical site master. internal.is_club_admin stays exactly
-- as it is: "the club stage needs CA" is the contract, and that helper is AA.3 row 4h's to retire.
create or replace function public.decide_player_dispensation(p_id uuid, p_stage text, p_approve boolean, p_governing_body_reference text default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
  v_player_name text;
begin
  select * into d from public.player_team_dispensation where id = p_id for update;
  if not found then
    raise exception 'Dispensation not found.';
  end if;
  select club_id into v_source_club from public.teams where id = d.source_team_id;

  -- SEPARATION OF DUTIES, before any stage-specific check, so it cannot be reached around.
  if d.requested_by is not null and d.requested_by = auth.uid() then
    raise exception 'The person who requested a dispensation cannot approve it. Someone else at the club must decide this stage.'
      using errcode = '42501';
  end if;

  if p_stage = 'source_team' then
    if d.status <> 'requested' then
      raise exception 'This dispensation is not awaiting source-team approval (current status: %).', d.status;
    end if;
    if not (internal.has_capability('approve_player_dispensations', 'team', v_source_club, d.source_team_id) or internal.has_capability('approve_player_dispensations', 'club', v_source_club)) then
      raise exception 'Not authorized to give source-team approval -- only the source team (the one lending the player) or that club''s fixture secretary/admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'source_team_approved' else 'rejected' end,
        source_team_decided_by = auth.uid(), source_team_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'club' then
    if d.status <> 'source_team_approved' then
      raise exception 'This dispensation is not awaiting club approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.has_site_capability('site.support.act_in_club')) then
      raise exception 'Not authorized to give club approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'club_approved' else 'rejected' end,
        club_decided_by = auth.uid(), club_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'governing_body' then
    if d.status <> 'club_approved' then
      raise exception 'This dispensation is not awaiting governing-body approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.has_site_capability('site.support.act_in_club')) then
      raise exception 'Not authorized to record governing-body approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    if p_approve and coalesce(trim(p_governing_body_reference), '') = '' then
      raise exception 'Recording governing-body approval requires a reference (e.g. the dispensation certificate/case number the club holds).';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'approved' else 'rejected' end,
        governing_body_reference = p_governing_body_reference,
        governing_body_decided_by = auth.uid(), governing_body_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  else
    raise exception 'Unknown dispensation stage: %', p_stage;
  end if;

  if not p_approve then
    update public.fixture_player_call_up
    set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
        decision_reason = coalesce(p_reason, 'The linked age-grade approval was rejected.')
    where eligibility_requirement_id = d.id and status = 'awaiting_eligibility';

    insert into public.notifications (user_id, type, title, body, data)
    select c.requested_by, 'fixture_call_up_decided', 'Call-up blocked',
      format('The age-grade approval for %s was rejected, so the linked call-up request cannot proceed.', (select first_name || ' ' || surname from public.players where id = d.player_id)),
      jsonb_build_object('dispensation_id', d.id)
    from public.fixture_player_call_up c
    where c.eligibility_requirement_id = d.id and c.requested_by is not null;
  elsif p_stage = 'governing_body' then
    update public.fixture_player_call_up
    set status = 'requested'
    where eligibility_requirement_id = d.id and status = 'awaiting_eligibility';

    insert into public.notifications (user_id, type, title, body, data)
    select c.requested_by, 'fixture_call_up_decided', 'Age-grade approval granted',
      format('The age-grade approval for %s has been recorded. The call-up can now proceed to the source team''s decision.', (select first_name || ' ' || surname from public.players where id = d.player_id)),
      jsonb_build_object('dispensation_id', d.id, 'call_up_id', c.id)
    from public.fixture_player_call_up c
    where c.eligibility_requirement_id = d.id and c.requested_by is not null;
  end if;

  select first_name || ' ' || surname into v_player_name from public.players where id = d.player_id;
  if not p_approve then
    perform internal.notify_club_safeguarding_officers(
      v_source_club, 'club.dispensation.notify', 'safeguarding_dispensation_decided', 'Dispensation declined',
      format('The dispensation for %s was declined at the %s stage.', coalesce(v_player_name, 'a player'), p_stage),
      jsonb_build_object('dispensation_id', d.id)
    );
  elsif p_stage = 'governing_body' then
    perform internal.notify_club_safeguarding_officers(
      v_source_club, 'club.dispensation.notify', 'safeguarding_dispensation_decided', 'Dispensation approved',
      format('The dispensation for %s has been fully approved.', coalesce(v_player_name, 'a player')),
      jsonb_build_object('dispensation_id', d.id)
    );
  end if;
end;
$$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'decide_player_dispensation') !~ 'requested_by = auth.uid' then
    raise exception 'dispensation separation of duties is not enforced.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'can_view_safeguarding_conversation') ~ '\mis_site_admin\(' then
    raise exception 'the blanket Site Admin safeguarding thread read is still installed.';
  end if;
end $$;

-- 13. The confirmation queue -------------------------------------------------------------------------
-- AN-6 needs a list of what is waiting, and the Site Admin page needs it without naming a role. Read
-- directly from role_assignments the page would have to filter on 'SAFEGUARDING_OFFICER' and
-- 'CLUB_ADMIN' string literals, which is the thing the role-literal guard exists to stop and the thing
-- this programme has been removing for six slices. The queue is a capability-gated RPC instead, so the
-- only authority question the page asks is the one the database answers.
create or replace function public.pending_safeguarding_nominations()
returns table (
  assignment_id uuid,
  club_id uuid,
  club_name text,
  person_name text,
  officer_type text,
  also_club_admin boolean,
  nominated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ra.id,
    ra.club_id,
    coalesce(d.name, 'Unknown club'),
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
    coalesce(ra.attributes ->> 'officer_type', 'primary'),
    -- AN-6 asks for this by name: a club whose Safeguarding Officer is also its administrator is a
    -- legitimate arrangement, and one the person confirming should be looking at rather than finding
    -- out later.
    exists (
      select 1 from public.role_assignments ca
      where ca.club_id = ra.club_id and ca.user_id = ra.user_id
        and ca.role_key = 'CLUB_ADMIN' and ca.state = 'ACTIVE'
    ),
    ra.granted_at
  from public.role_assignments ra
  join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
  left join public.profiles p on p.id = ra.user_id
  left join public.clubs c on c.id = ra.club_id
  left join public.club_directory d on d.id = c.directory_id
  where ra.role_key = 'SAFEGUARDING_OFFICER'
    and ra.state = 'ACTIVE'
    and ra.confirmation_state = 'PENDING_CONFIRMATION'
    and internal.has_site_capability('safeguarding.officer.confirm')
  order by ra.granted_at;
$$;

comment on function public.pending_safeguarding_nominations() is
  'AN-6 (Slice 4G): Safeguarding Officer nominations awaiting Ovalball, for whoever holds '
  'safeguarding.officer.confirm. Carries the "also Club Admin" flag AN-6 asks to be visible.';

revoke execute on function public.pending_safeguarding_nominations() from public, anon;
grant execute on function public.pending_safeguarding_nominations() to authenticated, service_role;

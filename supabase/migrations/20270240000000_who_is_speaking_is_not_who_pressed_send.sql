-- =====================================================================
-- WHO IS SPEAKING IS NOT WHO PRESSED SEND
--
-- THE PROBLEM
--
-- Ovalball has exactly one way to say "this did not come from a person, it
-- came from the organisation":
--
--     fixture_messages.is_site_admin_message boolean
--
-- One flag, one organisation, no identity. It cannot express "Under 11 Mixed
-- said this", it cannot express "Burnley RUFC said this", and it cannot be
-- checked -- nothing validates that the person setting it was entitled to
-- speak for anybody.
--
-- THE DISTINCTION THAT MATTERS
--
-- The ACTOR is always the authenticated human. Daniel Hartnell pressed Send,
-- and the audit trail must always be able to say so.
--
-- The SENDER IDENTITY is who the recipient should understand they heard
-- from: a person, a team, a club, or Ovalball itself. A parent reading
-- "Under 11 Mixed: training is cancelled" is being told something by the
-- team, not by whichever volunteer happened to be holding the phone -- and
-- when that volunteer leaves the club, the message still came from the team.
--
-- This matters for blocking, too. A personal block is a block on a PERSON.
-- It must not silence the club, and the club identity must not become a way
-- for a blocked person to get through. Both halves of that rule need the two
-- identities to be separately recorded and separately checked.
--
-- WHAT THIS MIGRATION ADDS
--
-- A typed identity, and one function that answers "may this actor speak as
-- that identity?" -- consulted by every future send path rather than
-- re-derived at each call site.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE TYPED IDENTITY
-- ---------------------------------------------------------------------
alter table public.fixture_messages
  add column if not exists sender_identity_type text not null default 'person',
  add column if not exists sender_identity_id uuid;

alter table public.fixture_messages
  drop constraint if exists fixture_messages_sender_identity_check;
alter table public.fixture_messages
  add constraint fixture_messages_sender_identity_check
  check (
    -- A person speaks as themselves; there is nothing to point at.
    (sender_identity_type = 'person' and sender_identity_id is null)
    -- Ovalball is a singleton; there is no id for "the platform".
    or (sender_identity_type = 'platform' and sender_identity_id is null)
    -- A team or a club is a specific team or club, by stable id.
    or (sender_identity_type in ('team', 'club') and sender_identity_id is not null)
  );

comment on column public.fixture_messages.sender_identity_type is
  'Who the RECIPIENT understands they heard from: person, team, club or platform. The actor -- who actually pressed Send -- is always sender_user_id, and is never replaced by this.';

-- Existing rows: everything ever sent was sent by a person as themselves,
-- except the handful flagged as platform messages. Backfilled from the flag
-- rather than guessed, so the old boolean and the new identity agree.
update public.fixture_messages
set sender_identity_type = 'platform'
where is_site_admin_message = true and sender_identity_type = 'person';

comment on column public.fixture_messages.is_site_admin_message is
  'LEGACY. Superseded by sender_identity_type = ''platform''. Retained so existing reads keep working; new code must use the typed identity.';

-- ---------------------------------------------------------------------
-- 2. MAY THIS ACTOR SPEAK AS THIS IDENTITY?
-- ---------------------------------------------------------------------
-- One answer, server-side, consulted by every send path. Without this, a
-- typed identity is just a string the client could set to anything -- which
-- would be worse than the boolean it replaces, because it would look
-- trustworthy.
create or replace function internal.may_send_as(
  p_identity_type text,
  p_identity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_club_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Speaking as yourself needs no authority beyond being signed in.
  if p_identity_type = 'person' then
    return p_identity_id is null;
  end if;

  -- Ovalball speaks for Ovalball. Deliberately the narrowest test in this
  -- function: an ordinary Site Admin role is not enough to issue platform
  -- communication in every recipient's Messenger.
  if p_identity_type = 'platform' then
    return p_identity_id is null and internal.is_full_site_admin();
  end if;

  if p_identity_type = 'team' then
    if p_identity_id is null then
      return false;
    end if;
    select club_id into v_club_id from public.teams where id = p_identity_id;
    if v_club_id is null then
      return false;
    end if;
    -- The SAME capability that already governs team community management,
    -- and the same club-scoped audience authority the email side uses. No
    -- new authority is invented here.
    return internal.has_capability('team.community.manage', 'team', v_club_id, p_identity_id)
        or internal.has_capability('team.community.manage', 'club', v_club_id, null)
        or internal.can_address_team_audience(p_identity_id)
        or internal.is_full_site_admin();
  end if;

  if p_identity_type = 'club' then
    if p_identity_id is null then
      return false;
    end if;
    return internal.can_address_club_audience(p_identity_id)
        or internal.can_manage_club_fixtures(p_identity_id)
        or internal.is_full_site_admin();
  end if;

  return false;
end;
$$;

comment on function internal.may_send_as(text, uuid) is
  'May the current actor speak as this organisational identity? The one authority check for sender identity: a Team Admin cannot send as another team, a Club Admin cannot send as another club, and nobody but a Full Site Admin speaks as Ovalball.';

-- ---------------------------------------------------------------------
-- 3. AND IT IS ENFORCED, NOT MERELY AVAILABLE
-- ---------------------------------------------------------------------
-- A trigger rather than a check constraint, because the answer depends on
-- who is asking. Any write path -- existing, new, or one nobody has thought
-- of yet -- is covered, which is the point.
create or replace function internal.enforce_sender_identity()
returns trigger
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  -- 'person' is the default and costs nothing to check; the others are the
  -- ones worth stopping.
  if new.sender_identity_type <> 'person' and not internal.may_send_as(new.sender_identity_type, new.sender_identity_id) then
    raise exception 'You are not authorised to send as that identity.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists fixture_messages_enforce_sender_identity on public.fixture_messages;
create trigger fixture_messages_enforce_sender_identity
  before insert on public.fixture_messages
  for each row execute function internal.enforce_sender_identity();

create index if not exists fixture_messages_sender_identity_idx
  on public.fixture_messages (sender_identity_type, sender_identity_id)
  where sender_identity_type <> 'person';

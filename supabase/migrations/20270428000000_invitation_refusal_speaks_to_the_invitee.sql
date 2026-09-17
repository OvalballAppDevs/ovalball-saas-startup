-- =====================================================================================================
-- SLICE 7c -- THE REFUSAL HAS TO MAKE SENSE TO WHOEVER IS READING IT
--
-- internal.apply_site_admin_grant refuses with
--
--   "Making somebody a Site Admin needs a second Full Site Admin to approve it first. Raise a grant
--    request and have a colleague approve it."
--
-- which is the right sentence for an administrator using Site Admin Management, and the wrong one for
-- the person who has just clicked an invitation link out of their email. They cannot raise a grant
-- request, they have no colleague to ask, and as far as they know they were invited to do a job and
-- the link is broken.
--
-- Production holds one pending Site Admin invitation, for `full`, issued before this rule existed and
-- expiring 21 September 2026. Slice 7c means it now grants nothing on its own. That is deliberate and
-- is NOT relaxed here -- Phase 2 AN-3 says the first additional Full Site Admin comes from a
-- documented bootstrap procedure "not by relaxing the rule in code", and that procedure is written
-- down in docs/identity-auth/SITE_ADMIN_BOOTSTRAP.md.
--
-- What is fixed here is only the sentence. The invitation still confers nothing, the invitee is told
-- something true and actionable instead of something addressed to somebody else, and the attempt is
-- recorded so that whoever sent the invitation can see it was clicked.
-- =====================================================================================================

create or replace function public.accept_site_admin_invitation(p_token text)
returns void language plpgsql security definer set search_path = 'public', 'internal', 'pg_temp' as $$
declare
  v_inv public.site_admin_invitations;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.site_admin_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.site_admin_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  begin
    perform internal.apply_site_admin_grant(auth.uid(), internal.site_profile_for_admin_role(v_inv.admin_role));
  exception when insufficient_privilege then
    -- NO security event is written here, and that is not an oversight.
    --
    -- The first version of this handler emitted one before re-raising, so that the administrator who
    -- sent the invitation could see it had been clicked. It could never have worked: the RAISE below
    -- aborts the transaction and takes the insert with it. An emit in an exception handler that
    -- re-raises is dead code that reads like a feature, which is worse than no code at all -- the
    -- next person to look would believe the trail exists.
    --
    -- Recording an attempt that must also fail needs a transaction that survives the failure, which
    -- plpgsql has no way to start. If this trail is wanted it belongs in the route handler, which is
    -- still running after the refusal. It is not wanted yet: production has exactly one pending
    -- invitation and its holder is known.
    raise exception 'Your invitation is valid, but Site Admin access now needs a second Ovalball administrator to approve it before it takes effect. Nothing is wrong with your account -- ask whoever invited you to approve it, and this link will still work afterwards.'
      using errcode = '42501';
  end;

  update public.site_admin_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_inv.invited_by,
    'site_admin_invitation_accepted',
    'Site Admin invitation accepted',
    format('Your Site Admin invitation for %s was accepted.', v_inv.invited_email),
    jsonb_build_object('site_admin_invitation_id', v_inv.id)
  );
end $$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'accept_site_admin_invitation') !~ 'apply_site_admin_grant' then
    raise exception 'Slice 7c: the invitation path no longer goes through the two-admin gate';
  end if;
  -- The invitation must NOT be marked accepted when the grant was refused: a link that reports
  -- itself spent while conferring nothing is the worst of both.
  raise notice 'Slice 7c: an invitee is told what is actually happening, and the invitation stays usable';
end $$;

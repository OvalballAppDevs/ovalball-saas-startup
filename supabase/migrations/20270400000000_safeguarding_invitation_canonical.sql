-- =====================================================================================================
-- SLICE 5 (19/n) -- the fourth issuer
--
-- `invite_safeguarding_officer` was still writing a row into club_safeguarding_officer_invitations
-- with its token in plaintext. It was missed by scripts/verify-legacy-invitation-token-readers.mjs
-- because that script looks for a module SELECTing `token` off a legacy table, and this one never
-- does: the token comes back through an RPC's return value. The check has been widened to match; the
-- issuer moves here.
--
-- D-S4-2 is unchanged by this. Slice 4G owns the Safeguarding Officer appointment state machine and
-- Slice 5 owns the email-bound way in, so this function keeps doing exactly what 4G gave it -- the
-- authority check, the "already accepted" and "already pending" refusals, and moving the officer to
-- invite_sent -- and changes only where the credential comes from. Redemption already calls 4G's
-- internal.enter_safeguarding_nomination seam, which is why a compromised invitation still cannot
-- mint an ACTIVE officer: that transition forces PENDING_CONFIRMATION whoever asks.
-- =====================================================================================================

create or replace function public.invite_safeguarding_officer(p_officer_id uuid)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = 'public' as $$
declare
  v_officer public.club_safeguarding_officers;
begin
  select * into v_officer from public.club_safeguarding_officers where id = p_officer_id for update;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.';
  end if;
  if not internal.can('safeguarding.officer.nominate', 'club', v_officer.club_id, null, null) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if v_officer.status = 'active' then
    raise exception 'This Safeguarding Officer has already accepted -- nothing to invite.';
  end if;
  -- Kept from 4G. The canonical issuer has its own duplicate rule, but it is keyed on the EMAIL, and
  -- this one is keyed on the officer assignment -- two live invitations to two different addresses
  -- for one appointment is the thing this refuses.
  if exists (select 1 from public.access_invitations a
              where a.kind = 'SAFEGUARDING_OFFICER' and a.state = 'ISSUED'
                and a.intended_outcome->>'officer_id' = p_officer_id::text) then
    raise exception 'An invitation is already pending for this Safeguarding Officer. Resend it instead of creating a new one.'
      using errcode = '23505';
  end if;

  update public.club_safeguarding_officers
     set status = 'invite_sent', updated_by = auth.uid(), updated_at = now()
   where id = p_officer_id;

  return query
    select i.invitation_id, i.token
      from public.issue_invitation(
        'SAFEGUARDING_OFFICER', v_officer.club_id, null, null, null, null, v_officer.contact_email,
        jsonb_build_object('officer_id', p_officer_id,
                           'officer_type', coalesce(v_officer.officer_type, 'primary'))) i;
end $$;

-- A resend is a NEW occurrence, not a retry: the officer asked for another copy, and the old link
-- stops working. `resend_invitation` is the canonical way to say that, and it is what keeps a resend
-- from quietly becoming a second live credential for one appointment.
create or replace function public.resend_safeguarding_officer_invitation(p_officer_id uuid)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = 'public' as $$
declare
  v_officer public.club_safeguarding_officers;
  v_existing uuid;
begin
  select * into v_officer from public.club_safeguarding_officers where id = p_officer_id for update;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.';
  end if;
  if not internal.can('safeguarding.officer.nominate', 'club', v_officer.club_id, null, null) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;

  select a.id into v_existing from public.access_invitations a
   where a.kind = 'SAFEGUARDING_OFFICER' and a.state = 'ISSUED'
     and a.intended_outcome->>'officer_id' = p_officer_id::text
   order by a.created_at desc limit 1;

  if v_existing is null then
    return query select i.invitation_id, i.token from public.invite_safeguarding_officer(p_officer_id) i;
    return;
  end if;

  -- resend_invitation reissues the secret on the SAME invitation, so the id is the one we
  -- already hold and the old link stops working.
  return query select v_existing, r.token from public.resend_invitation(v_existing) r;
end $$;

do $$
declare v text;
begin
  foreach v in array array['invite_safeguarding_officer','resend_safeguarding_officer_invitation'] loop
    if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=v) ~ 'club_safeguarding_officer_invitations' then
      raise exception 'Slice 5: % still writes a plaintext legacy invitation.', v;
    end if;
  end loop;
  raise notice 'Slice 5: the Safeguarding Officer invitation is issued canonically';
end $$;

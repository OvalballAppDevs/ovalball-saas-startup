-- =====================================================================================================
-- SLICE 5 (20/n) -- the Safeguarding Officer outcome, in full
--
-- The canonical SAFEGUARDING_OFFICER redemption entered 4G's nomination seam and did nothing else. The
-- legacy accept_safeguarding_officer_invitation does four things, and its own comment says which of
-- them Slice 5 inherits:
--
--     "THE SAME SEAM, and this is the shape Slice 5 inherits: admit the person, then enter the one
--      state machine."
--
-- It admits the club member behind the people lock, links and activates the officer record, enters the
-- nomination against that officer, and tells whoever invited them. The canonical path did the third
-- only -- and, because it did not admit anybody, it REFUSED anyone who was not already a member of the
-- club with MEMBERSHIP_REQUIRED. Which is every external nominee: exactly the case Slice 5's
-- email-bound invitation exists for. The external route did not work.
--
-- This is the same defect as the five dropped claim effects, from the same cause: a canonical
-- replacement written from what the design document lists rather than from what the code it replaces
-- actually does.
--
-- AN-6 is untouched. internal.enter_safeguarding_nomination forces PENDING_CONFIRMATION whoever calls
-- it, so accepting an invitation still produces a nomination awaiting Ovalball's confirmation and
-- never an active officer.
-- =====================================================================================================

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  if v ~ 'safeguarding_officer_invitation_accepted' then return; end if;   -- already applied

  v := replace(v,
E'  elsif v.kind = ''SAFEGUARDING_OFFICER'' then
    -- D-S4-2: Slice 5 owns the email-bound entry, 4G owns the state machine. This calls 4G''s seam.
    select m.id into v_membership from public.club_memberships m
     where m.club_id = v.club_id and m.user_id = v_actor and m.state = ''ACTIVE'';
    if v_membership is null then
      perform internal.invitation_refused(v.id, ''membership_required'');
      return jsonb_build_object(''outcome'',''REFUSED'',''reason'',''MEMBERSHIP_REQUIRED'',''message'',''You need to be an active member of that club before you can be its Safeguarding Officer.'');
    end if;
    v_id := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>''officer_type'',''primary''),
      ''SAFEGUARDING_APPOINTMENT'', v.id, ''accepted invitation'');
    v_result := jsonb_build_object(''outcome'',''PENDING_CONFIRMATION'',''assignment_id'',v_id);',
E'  elsif v.kind = ''SAFEGUARDING_OFFICER'' then
    -- D-S4-2: Slice 5 owns the email-bound entry, 4G owns the state machine. Admit the person, then
    -- enter the one state machine -- which is the shape 4G said Slice 5 inherits, and the reason an
    -- EXTERNAL nominee can accept at all. Requiring a membership first would have made the
    -- email-bound invitation useful only to people who did not need it.
    v_officer := v.intended_outcome->>''officer_id'';
    perform internal.lock_club_people(v.club_id);
    v_membership := internal.admit_club_member(v.club_id, v_actor, ''SAFEGUARDING_APPOINTMENT'', null, null, null);

    if v_officer is not null then
      update public.club_safeguarding_officers
         set user_id = v_actor, status = ''active'', activated_at = now(),
             updated_by = v_actor, updated_at = now()
       where id = v_officer::uuid;
    end if;

    -- The officer record says active; the AUTHORITY does not. enter_safeguarding_nomination forces
    -- PENDING_CONFIRMATION whoever calls it, so this is a contact record that has been claimed and an
    -- appointment still waiting on Ovalball (AN-6).
    v_id := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>''officer_type'',''primary''),
      ''SAFEGUARDING_APPOINTMENT'', v.id, ''accepted invitation'',
      case when v_officer is null then null else v_officer::uuid end);

    insert into public.notifications (user_id, type, title, body, data)
    values (v.issued_by, ''safeguarding_officer_invitation_accepted'',
            ''Safeguarding Officer invitation accepted'',
            format(''Your Safeguarding Officer invitation for %s was accepted. Ovalball must confirm the appointment before it grants anything.'',
                   v.invited_email_normalised),
            jsonb_build_object(''officer_id'', v_officer, ''invitation_id'', v.id));

    v_result := jsonb_build_object(''outcome'',''PENDING_CONFIRMATION'',''assignment_id'',v_id,
                                   ''membership_id'',v_membership);');

  v := replace(v, '  v_teams jsonb;', E'  v_teams jsonb;\n  v_officer text;');

  execute format('create or replace function public.redeem_invitation(p_token text default null, p_code text default null) returns jsonb language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The legacy accept stays exactly as it was, and stays legacy-only.
--
-- Making it an adapter that falls back to public.redeem_invitation was tried and withdrawn. Its
-- callers expect a REFUSAL TO RAISE, and the canonical path refuses by RETURNING precisely so that the
-- attempt it just recorded survives (D-S5-AUTO-2). Turning that return back into a raise throws the
-- record away with it -- the M-5 lesson -- so every refusal reached through the adapter would have
-- been invisible to the rate limits, which is a way of guessing at invitation tokens that the
-- canonical path is specifically built to cap.
--
-- So the two paths stay separate, and nothing is lost by that: a legacy link in an inbox goes to the
-- legacy route and is honoured there until it expires (Phase 2 O.5), and a canonical link goes to
-- /join. The legacy route already redirects an unrecognised token to /join, so a canonical token
-- pasted into an old URL still arrives somewhere that can answer it.
-- ---------------------------------------------------------------------------------------------------

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  if v !~ 'admit_club_member\(v.club_id, v_actor' then
    raise exception 'Slice 5: an external Safeguarding Officer nominee still cannot be admitted.';
  end if;
  if v !~ 'lock_club_people\(v.club_id\)' then
    raise exception 'Slice 5: the Safeguarding Officer outcome does not take the club-people lock.';
  end if;
  raise notice 'Slice 5: an external Safeguarding Officer nominee can accept';
end $$;

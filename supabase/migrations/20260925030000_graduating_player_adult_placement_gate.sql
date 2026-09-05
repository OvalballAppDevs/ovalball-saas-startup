-- RESUME SEASON HANDOVER Section 28: place_graduating_player() must not
-- treat "the source team was Senior Colts" as sufficient authorization
-- to place a player on an adult (category = 'senior') team. Being
-- eligible to LEAVE a graduated Colts/Girls-U16 cohort says nothing
-- about whether THIS player is old enough, under governing-body rules,
-- to play adult rugby -- that is a real safeguarding/regulatory
-- question this product has no authority to answer on its own.
--
-- Ovalball already has the correct mechanism for exactly this
-- question: the player_team_dispensation staged approval chain
-- (source_team -> club -> governing_body), which exists precisely to
-- record that a real external governing body approved a player moving
-- outside ordinary age-grade eligibility. Rather than inventing new,
-- separate age-rule logic here (which would either hardcode a
-- particular union's regulation as if Ovalball itself could grant that
-- approval, or duplicate the dispensation domain), this migration
-- requires an already-APPROVED dispensation record for the exact
-- (player, target team) pair before allowing an under-18 placement
-- onto a senior team. "Ovalball records approval. Ovalball does not
-- grant governing-body approval."
--
-- Conservative, disclosed rule (deliberately not attempting to encode
-- any specific union's exact age-dispensation regulation, which varies
-- and changes): a player is placed onto a senior team without extra
-- gating only once their real recorded date_of_birth shows they have
-- turned 18. Missing date_of_birth blocks adult placement outright
-- (never assume adulthood without real data) rather than silently
-- allowing it. Any placement of someone still under 18 onto a senior
-- team requires an approved, governing-body-referenced dispensation
-- already on file for that exact player and target team -- there is no
-- "one age up is always fine" shortcut and no path that lets Ovalball
-- itself stand in for the governing body's decision.
create or replace function public.place_graduating_player(p_queue_id uuid, p_target_team_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q public.player_graduation_queue;
  v_target_club_id uuid;
  v_target_category text;
  v_dob date;
  v_is_adult boolean;
  v_has_approved_dispensation boolean;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  select club_id, category into v_target_club_id, v_target_category from public.teams where id = p_target_team_id;
  if v_target_club_id is distinct from q.club_id then
    raise exception 'A graduating player can only be placed onto a team at the same club they graduated from.' using errcode = '23514';
  end if;
  if not (internal.has_capability('place_graduating_players', 'team', q.club_id, p_target_team_id) or internal.has_capability('place_graduating_players', 'club', q.club_id)) then
    raise exception 'Not authorized to place this player.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  if v_target_category = 'senior' then
    select date_of_birth into v_dob from public.players where id = q.player_id;
    if v_dob is null then
      raise exception 'This player has no recorded date of birth -- Ovalball cannot verify they are old enough for adult rugby. Record their date of birth before placing them on a senior team.' using errcode = '23514';
    end if;

    v_is_adult := v_dob <= (current_date - interval '18 years')::date;

    if not v_is_adult then
      select exists (
        select 1 from public.player_team_dispensation d
        where d.player_id = q.player_id
          and d.target_team_id = p_target_team_id
          and d.status = 'approved'
          and d.governing_body_reference is not null
      ) into v_has_approved_dispensation;

      if not v_has_approved_dispensation then
        raise exception 'This player is under 18 and cannot be placed on a senior team without an approved governing-body dispensation on file for this exact player and team. Request a dispensation first (Season Handover -> Dispensations) and have the club record the governing body''s approval reference once granted -- Ovalball records that approval, it does not grant it on the governing body''s behalf.' using errcode = '23514';
      end if;
    end if;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, created_by)
  values (q.player_id, p_target_team_id, 'active', auth.uid());

  update public.player_graduation_queue
  set status = 'placed', placed_team_id = p_target_team_id, placed_by = auth.uid(), placed_at = now(), updated_at = now()
  where id = p_queue_id;
end;
$$;

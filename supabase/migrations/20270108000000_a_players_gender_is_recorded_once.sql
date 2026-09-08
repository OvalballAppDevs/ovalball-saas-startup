-- A player's gender is recorded once, and then it stays.
--
-- set_player_playing_pathway existed to solve one problem: a legacy player
-- whose playing_pathway was never recorded cannot be allocated to an age grade
-- at all, and Ovalball must never guess, so somebody with the right authority
-- has to supply it. That is COMPLETING a missing value.
--
-- What it also allowed, because it wrote unconditionally, was CHANGING an
-- existing one -- and the Playing Details screen offered that as an ordinary
-- control, so a parent could flip their child's gender back and forth like a
-- preference. It is not a preference. It decides which age grade and which
-- pathway a child plays in, it is checked by the membership compatibility
-- guard, and it is the kind of fact a governing body relies on.
--
-- So the two cases are separated:
--
--   NULL -> a value      completing. The guardian, the adult player, or a
--                        Full Site Admin may do it, exactly as before.
--   a value -> another   changing. Refused here, for everyone below Full Site
--                        Admin, so a genuine error is corrected under real
--                        authority rather than self-served.
--
-- Enforced in the function rather than by hiding the control, because a hidden
-- control is a UI state and this is a rule.

create or replace function public.set_player_playing_pathway(p_player_id uuid, p_playing_pathway text)
returns table(review_state text, reason text, resolved boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player public.players;
  r record;
  v_state text;
  v_reason text;
begin
  select * into v_player from public.players where id = p_player_id for update;
  if not found then raise exception 'Player not found.'; end if;

  if not internal.may_complete_player_profile(p_player_id) then
    raise exception 'Only this player''s guardian, the player themselves, or a Full Site Admin may record this information.'
      using errcode = '42501';
  end if;

  if p_playing_pathway is null or p_playing_pathway not in ('MALE', 'FEMALE') then
    raise exception 'Choose Boys or Girls. Rugby runs separate boys'' and girls'' age grades from Under-12, and Ovalball must never assume which one a player is registered in.'
      using errcode = '23514';
  end if;

  -- Already recorded. Re-sending the same value is not a change and is allowed
  -- silently, so a double submit or a stale form is not an error; a DIFFERENT
  -- value is refused.
  if v_player.playing_pathway is not null and v_player.playing_pathway <> p_playing_pathway then
    if not internal.is_full_site_admin() then
      raise exception 'This player''s gender has already been recorded and cannot be changed here. If it is wrong, your club can raise it with Ovalball so it is corrected properly.'
        using errcode = '42501';
    end if;
  end if;

  update public.players
  set playing_pathway = p_playing_pathway, updated_by = auth.uid(), updated_at = now()
  where id = p_player_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('players', p_player_id, 'update', auth.uid(),
    jsonb_build_object('playing_pathway_was_recorded', v_player.playing_pathway is not null),
    jsonb_build_object('event',
      case when v_player.playing_pathway is null
        then 'PLAYER_PLAYING_PATHWAY_RECORDED'
        else 'PLAYER_PLAYING_PATHWAY_CORRECTED_BY_SITE_ADMIN' end));

  -- Anything that was waiting on this answer is recalculated now, so the
  -- person who supplied it sees the result rather than being told to go and
  -- look somewhere else. Only handovers that have not run, and only the
  -- proposals nobody has decided.
  for r in
    select distinct ro.id
    from public.age_grade_rollovers ro
    join public.age_grade_rollover_player_proposals pp on pp.rollover_id = ro.id
    where pp.player_id = p_player_id and ro.applied_at is null and pp.placement_applied_at is null
  loop
    perform internal.refresh_rollover_player_proposals(r.id);
  end loop;

  select pp.review_state, pp.reason into v_state, v_reason
  from public.age_grade_rollover_player_proposals pp
  join public.age_grade_rollovers ro on ro.id = pp.rollover_id
  where pp.player_id = p_player_id and ro.applied_at is null
  order by pp.created_at desc
  limit 1;

  return query select v_state, v_reason, v_state = 'READY';
end;
$function$;

comment on function public.set_player_playing_pathway(uuid, text) is
  'Records a player''s gender ONCE. A guardian, the adult player, or a Full Site Admin may supply a missing value; only a Full Site Admin may change one that is already recorded, because it decides the player''s age grade and pathway and is not a preference to be toggled.';

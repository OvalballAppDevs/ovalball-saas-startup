-- =====================================================================
-- A PICKER OFFERS ONLY WHAT THE PIPELINE WOULD ACCEPT
--
-- internal.resolve_audience already handles scope = 'selected': it takes
-- player ids, authorises each one through internal.may_address_player, and
-- refuses the whole send if any is not the sender's to address. The server
-- side of individual selection has been finished since 20270244000000.
--
-- What has been missing is the LIST. A composer cannot offer a choice it
-- cannot display, and the obvious ways to build that list are both wrong:
--
--   Query the roster in TypeScript. The picker then decides for itself who is
--   selectable, and drifts from may_address_player the first time authority
--   changes -- offering a player the send path then refuses, which reads as a
--   bug rather than as a boundary.
--
--   Return the resolved RECIPIENTS. That hands the composer the adults behind
--   every child, which is both more than the sender needs and exactly the
--   audience data this domain exists to keep private.
--
-- So this returns the PLAYERS of the base audience -- the unit an
-- announcement audience is actually made of -- filtered by the same authority
-- the send path uses, and annotated with reachability from the one canonical
-- safeguarding predicate.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN: any guardian, any recipient, any
-- email address, any user id. A coach choosing who to tell about Saturday
-- picks children, not parents' inboxes. recipient_count is a NUMBER per
-- player, never a list, so the composer can explain why selecting three
-- children reaches five people without ever naming one of them.
--
-- The player names themselves are not new exposure: anyone who passes
-- can_address_team_audience already sees this roster in Team Management.
-- =====================================================================

create or replace function public.selectable_announcement_audience(
  p_scope text,
  p_scope_id uuid
)
returns table (
  player_id uuid,
  display_name text,
  is_adult boolean,
  reachable boolean,
  outcome text,
  recipient_count integer
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- AUTHORITY FIRST, and the same two predicates the resolver uses. A scope
  -- the sender may not address returns an error, never an empty list: "you
  -- cannot see this" and "this is empty" are different answers and a composer
  -- must not confuse them.
  if p_scope = 'team' then
    if p_scope_id is null then
      raise exception 'A team audience needs a team.';
    end if;
    if not internal.can_address_team_audience(p_scope_id) then
      raise exception 'You are not authorised to address this team''s audience.' using errcode = '42501';
    end if;
    select array_agg(t.player_id) into v_player_ids
    from internal.team_playing_group_player_ids(p_scope_id) t;

  elsif p_scope = 'club' then
    if p_scope_id is null then
      raise exception 'A club audience needs a club.';
    end if;
    if not internal.can_address_club_audience(p_scope_id) then
      raise exception 'You are not authorised to address this club''s audience.' using errcode = '42501';
    end if;
    select array_agg(c.player_id) into v_player_ids
    from internal.club_playing_group_player_ids(p_scope_id) c;

  else
    -- Platform-wide selection is deliberately not offered. Choosing
    -- individuals out of every player on Ovalball is not a product need, and
    -- building the list would mean materialising exactly the cross-club roster
    -- nothing else in the product exposes.
    raise exception 'Individual selection is available for a team or a club.';
  end if;

  v_player_ids := coalesce(v_player_ids, array[]::uuid[]);

  return query
  with eligibility as (
    -- THE ONE CANONICAL ANSWER. Reachability is not recomputed here, and
    -- neither is adulthood -- both come back from the same predicate that
    -- decides who actually receives the announcement, so the picker cannot
    -- disagree with the send.
    select e.player_id as pid,
           bool_or(e.user_id is not null) as has_recipient,
           count(e.user_id)::integer as recipients,
           -- min() over a per-player constant; the aggregate is only here to
           -- collapse the guardian rows, not to choose between answers.
           min(e.outcome) filter (where e.user_id is null) as gap_outcome,
           bool_or(e.is_adult) as adult
    from internal.player_contact_eligibility(v_player_ids) e
    group by e.player_id
  )
  select
    p.id,
    -- Read as stored. internal.normalise_person_name already owns how a
    -- person's name is spelled; re-formatting it here would put a second
    -- opinion on a screen (see CLAUDE.md).
    btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')),
    coalesce(el.adult, false),
    coalesce(el.has_recipient, false),
    case when coalesce(el.has_recipient, false) then 'ELIGIBLE'
         else coalesce(el.gap_outcome, 'NO_ELIGIBLE_GUARDIAN') end,
    coalesce(el.recipients, 0)
  from eligibility el
  join public.players p on p.id = el.pid
  -- THE SAME PER-PLAYER AUTHORITY THE SEND PATH APPLIES. Belt and braces
  -- against a base audience that contains somebody the sender may not
  -- individually address: the picker must never offer a row that
  -- resolve_audience would then reject.
  where internal.may_address_player(p.id)
  order by btrim(coalesce(p.surname, '')), btrim(coalesce(p.first_name, '')), p.id;
end;
$$;

comment on function public.selectable_announcement_audience(text, uuid) is
  'The players a sender may individually choose from within a team or club audience, with whether each is reachable and how many recipients they resolve to. Returns no guardian, recipient or contact detail -- only the players, filtered by the same authority the send path applies.';

revoke all on function public.selectable_announcement_audience(text, uuid) from public, anon;
grant execute on function public.selectable_announcement_audience(text, uuid) to authenticated;

-- One guard, so no membership writer can place a player across pathways.
--
-- THE RISK
--
-- Seven server-side functions create player_team_memberships: guardian signup,
-- invitation acceptance, duplicate-review resolution (twice), graduation
-- placement, handover placement, and guardian link approval. Each knows a
-- team_id. None of them checked whether the player belongs in that team's
-- pathway, so a girl could be written into a Boys U12 by any of them, and by
-- any path added later that also knows a team_id.
--
-- Duplicating the rule into seven callers would guarantee the eighth forgets
-- it. So the rule lives once, in a trigger, and every writer is covered by
-- construction -- including writers that do not exist yet.
--
-- WHAT IT DECIDES, AND WHAT IT LEAVES ALONE
--
-- Only pathway compatibility. Age-grade movement is already governed by
-- internal.resolve_player_movement_eligibility and is not re-litigated here --
-- a thirteen-year-old boy training up with the U14s is a movement question,
-- not a pathway one, and this guard stays out of it.
--
-- Compatibility is read from the CANONICAL TEAM TYPE, never from teams.gender
-- and never from a display name. teams.gender is nullable and several real
-- teams carry NULL; the canonical type behind them is not, and it is the
-- structured metadata the directory exists to provide.
--
--   canonical gender 'mixed'   -> any pathway, and a missing one
--   canonical gender 'boys'    -> MALE
--   canonical gender 'girls'   -> FEMALE
--   canonical gender 'mens'    -> MALE
--   canonical gender 'womens'  -> FEMALE
--
-- Mixed accepting both is the point, not a loophole: it proves the guard is
-- not the naive "player pathway must equal team gender". A boy and a girl
-- playing mini-rugby together is correct, and the directory is what says so.
--
-- A player whose pathway is unknown may join a Mixed team, because the answer
-- would not change anything, but not a gendered one -- the same fail-closed
-- rule the allocation resolver uses.
--
-- An approved governing-body dispensation for that exact player and team is
-- the escape hatch, reusing player_team_dispensation rather than inventing a
-- second approval concept.

create or replace function internal.assert_player_team_pathway_compatible(
  p_player_id uuid, p_team_id uuid
) returns void
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_pathway text;
  v_first text;
  v_team_gender text;
  v_team_label text;
begin
  select p.playing_pathway, p.first_name into v_pathway, v_first
  from public.players p where p.id = p_player_id;

  select ctt.gender, t.display_name into v_team_gender, v_team_label
  from public.teams t
  left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
  where t.id = p_team_id;

  -- No canonical identity means nothing structured to check against. An
  -- active team always has one; this covers inactive or in-flight rows rather
  -- than inventing a decision from a display name.
  if v_team_gender is null then return; end if;

  -- Mixed rugby is played by everyone, so there is nothing to verify.
  if v_team_gender = 'mixed' then return; end if;

  if v_pathway is null then
    raise exception 'Ovalball does not know which playing pathway % is registered in, so they cannot be added to %. Add their playing information to their profile first -- it must never be assumed from the team.',
      coalesce(v_first, 'this player'), coalesce(v_team_label, 'this team')
      using errcode = '23514';
  end if;

  if (v_team_gender in ('boys', 'mens') and v_pathway = 'MALE')
     or (v_team_gender in ('girls', 'womens') and v_pathway = 'FEMALE') then
    return;
  end if;

  -- Cross-pathway. Permitted only with a recorded governing-body approval for
  -- this exact player and team.
  if exists (
    select 1 from public.player_team_dispensation d
    where d.player_id = p_player_id and d.target_team_id = p_team_id
      and d.status = 'approved' and d.governing_body_reference is not null
  ) then
    return;
  end if;

  raise exception '% cannot be added to %: that team is in the other playing pathway. This is a governing-body rule, not an Ovalball setting, and it needs a recorded dispensation rather than an override here.',
    coalesce(v_first, 'This player'), coalesce(v_team_label, 'that team')
    using errcode = '23514';
end;
$function$;

comment on function internal.assert_player_team_pathway_compatible(uuid, uuid) is
  'The single pathway-compatibility rule for player_team_memberships. Reads the canonical team type, never teams.gender or a display name. Mixed accepts every pathway; a gendered team requires the matching one, or a recorded dispensation.';

create or replace function internal.player_membership_pathway_guard()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  -- Only where a membership is real or proposed. An ended membership is
  -- history and is never re-judged by today's rules.
  if new.status in ('active', 'pending') then
    perform internal.assert_player_team_pathway_compatible(new.player_id, new.team_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists player_membership_pathway_guard on public.player_team_memberships;
create trigger player_membership_pathway_guard
  before insert or update of player_id, team_id, status on public.player_team_memberships
  for each row execute function internal.player_membership_pathway_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'player_membership_pathway_guard') then
    raise exception 'The membership pathway guard is not installed.';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'assert_player_team_pathway_compatible') ~ 'teams\.gender|display_name.*ilike' then
    raise exception 'The guard reads a mutable team label instead of the canonical type.';
  end if;
end $$;

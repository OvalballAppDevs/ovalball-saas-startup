-- =====================================================================================================
-- A CLAIM SEEDS THE TEAMS IT ASKED FOR, AND A FAMILY READS THE ONE MEMBERSHIP STANDING (2026-10-06)
--
-- 1. SIGNUP'S TEAMS WERE DROPPED AT CLAIM APPROVAL (people audit H2, F3-01). Signup names each team it
--    proposes by its canonical display name ("Under 12 Boys", "Under 11 Mixed", "Men's 1st Team"), the
--    same name every surface uses. internal.seed_teams_from_proposal still matched the phrasing signup used
--    before it adopted that name ("Under 12", "Under 12 Girls"), so every boys and mixed side -- and any
--    senior side whose compact label differs -- matched nothing and was silently skipped when Ovalball
--    approved the claim. It now finds the identity by its canonical key when one is sent, by its display or
--    compact name for the club's rugby code (only identities that code offers), and by an { ageGroup,
--    gender } pair; the old phrasing still works, so a claim submitted before this change seeds too.
--
-- 2. A FAMILY'S VIEW OF ITS OWN MEMBERSHIP WAS ITS OWN DERIVATION (membership audit M10, D11-D13). It was
--    worked out in the client from rows only the PAYER can read, so a second guardian saw "set up required"
--    for a healthy membership, and a payment that failed while the Direct Debit was live projected nothing
--    -- which left the payment-failed notice paired to an item that did not exist. family_membership_standing
--    answers a child's guardian (or the linked player) with the same standing the club and the team see,
--    from internal.membership_standing (20270746000000), and says only whether the caller is the payer --
--    never who is.
--
-- Tests: supabase/tests/admission_journeys.sql (JD3b), supabase/tests/membership_standing.sql (MF1-MF5).
-- =====================================================================================================

create or replace function internal.seed_teams_from_proposal(p_club_id uuid, p_rugby_code text, p_proposed_teams jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_letter text;
  v_created integer := 0;
  v_category text;
  v_age_group text;
  v_gender text;
  v_squad text;
  v_label text;
  v_key text;
  v_age text;
  v_sex text;
begin
  if p_proposed_teams is null or jsonb_typeof(p_proposed_teams) <> 'array' then return 0; end if;

  for v_item in select * from jsonb_array_elements(p_proposed_teams)
  loop
    v_category := null;
    v_label := lower(btrim(coalesce(v_item->>'category', v_item->>'label', '')));
    v_key := nullif(btrim(coalesce(v_item->>'key', '')), '');
    v_age := upper(nullif(btrim(coalesce(v_item->>'ageGroup', v_item->>'age_group', '')), ''));
    v_sex := lower(nullif(btrim(coalesce(v_item->>'gender', '')), ''));

    -- ONE IDENTITY, FOUND THE WAY THE CLUB'S OWN CODE OFFERS IT: by key, by the display name every surface
    -- uses, by the compact name, by an age group and gender, or by the phrasing signup used to send.
    select t.category, t.age_group, t.gender, t.fixed_squad_designation
      into v_category, v_age_group, v_gender, v_squad
      from public.canonical_team_types_by_code t
      cross join lateral internal.canonical_team_presentation(t.category, t.age_group, t.gender, t.fixed_squad_designation, t.rugby_code) p
     where t.rugby_code = p_rugby_code
       and t.is_offered
       and (
         (v_key is not null and t.key = v_key)
         or (v_label <> '' and (lower(p.display) = v_label or lower(p.compact) = v_label or lower(t.label) = v_label))
         or (v_age is not null and t.category = 'youth' and t.age_group = v_age and (v_sex is null or t.gender = v_sex))
         or (v_label <> '' and t.category = 'youth'
             and lower(case when t.gender = 'girls' then 'Under ' || substring(t.age_group from 2) || ' Girls'
                            else 'Under ' || substring(t.age_group from 2) end) = v_label)
       )
     order by (v_key is not null and t.key = v_key) desc,
              (lower(p.display) = v_label) desc,
              (lower(p.compact) = v_label) desc,
              t.sort_order nulls last
     limit 1;

    if v_category is null then
      continue;
    end if;

    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
    values (p_club_id, p_rugby_code, v_category, v_age_group, v_gender, v_squad, 'pending', 'pending', auth.uid(), auth.uid())
    on conflict (club_id, identity_key) do nothing;
    if found then v_created := v_created + 1; end if;

    if v_category = 'youth' then
      for v_letter in select jsonb_array_elements_text(coalesce(v_item->'additionalLetters', '[]'::jsonb))
      loop
        insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
        values (p_club_id, p_rugby_code, v_category, v_age_group, v_gender, v_letter, 'pending', 'pending', auth.uid(), auth.uid())
        on conflict (club_id, identity_key) do nothing;
        if found then v_created := v_created + 1; end if;
      end loop;
    end if;
  end loop;

  return v_created;
end;
$function$;

revoke all on function internal.seed_teams_from_proposal(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. A family's view of the one standing
-- ---------------------------------------------------------------------------------------------------
create or replace function public.family_membership_standing(p_player_id uuid, p_club_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := internal.actor();
  s record;
  v_enabled boolean;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- THE FAMILY'S OWN AUTHORITY: an active guardian of this child, or the linked player themselves. Never a
  -- staff capability -- a coach who is not the child's guardian reads nothing here.
  if not (internal.is_active_player_guardian(p_player_id) or internal.is_own_linked_player(p_player_id)) then
    raise exception 'You can only see the membership of your own family.' using errcode = '42501';
  end if;

  select coalesce(bool_or(p.enabled), false) into v_enabled from public.club_subscription_programmes p where p.club_id = p_club_id;
  if not v_enabled then
    return jsonb_build_object('programme_enabled', false);
  end if;

  select * into s from internal.membership_standing(p_club_id, current_date) ms where ms.player_id = p_player_id;
  if s.player_id is null then
    return jsonb_build_object('programme_enabled', true, 'standing', null);
  end if;

  return jsonb_build_object(
    'programme_enabled', true,
    'standing', s.standing,
    'reason', s.reason,
    'amount_due_minor', s.amount_due_minor,
    'monthly_amount_minor', s.monthly_amount_minor,
    'next_collection_date', s.next_collection_date,
    'has_payer', s.payer_user_id is not null,
    -- Whether the reader is the payer, never who is: a second guardian learns the membership is in hand.
    'payer_is_you', s.payer_user_id is not null and s.payer_user_id = v_actor);
end;
$function$;

revoke all on function public.family_membership_standing(uuid, uuid) from public, anon;
grant execute on function public.family_membership_standing(uuid, uuid) to authenticated;

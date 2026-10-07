-- =====================================================================================================
-- A CLUB HEARS WHEN GOCARDLESS VERIFIES ITS ACCOUNT (Club Memberships, Part 1)
--
-- A club that has just connected a new GoCardless account usually finishes setting up while GoCardless is still
-- reviewing it. Everything else is ready, Activate waits for GoCardless, and until now nothing told anybody when
-- the review ended: switching memberships on depended on a volunteer remembering to come back days later.
--
-- `update_gocardless_verification_status` is the one place Ovalball records a verification status GoCardless gave
-- (the OAuth return, the app's finish, a creditor_updated webhook, the replay route's re-check). It is unchanged
-- except for one thing: the moment a live connection BECOMES verified while the club has not switched memberships
-- on, the people who can switch them on are told, through the one notification system. A status that was already
-- 'successful' (a webhook delivered twice, a replay, a re-check) tells nobody again.
--
-- WHO IS TOLD: the club's active members who hold `finance.subscription.configure` there -- the people Activate is
-- for. Nobody else learns anything about the club's account.
-- =====================================================================================================

insert into public.notification_types (type_key, topic_key)
values ('membership_gocardless_verified', 'membership_payments')
on conflict (type_key) do nothing;

create or replace function public.update_gocardless_verification_status(p_club_id uuid, p_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_was text;
  v_updated integer;
  v_enabled boolean;
  v_club_name text;
  v_to uuid[];
begin
  if p_status not in ('action_required', 'in_review', 'successful', 'unknown') then
    raise exception 'Invalid verification status.';
  end if;
  -- 'unknown' is not an answer from GoCardless (20270749000000, G8): it never replaces one GoCardless gave.
  if p_status = 'unknown' then
    return;
  end if;

  select verification_status into v_was
    from public.gocardless_merchant_connections
   where club_id = p_club_id and disconnected_at is null
   for update;

  update public.gocardless_merchant_connections
  set verification_status = p_status, status_checked_at = now()
  where club_id = p_club_id and disconnected_at is null;
  get diagnostics v_updated = row_count;

  -- BECAME VERIFIED, and the club has not switched memberships on: tell the people who can.
  if v_updated > 0 and p_status = 'successful' and v_was is distinct from 'successful' then
    select p.enabled into v_enabled from public.club_subscription_programmes p where p.club_id = p_club_id;
    if not coalesce(v_enabled, false) then
      select array_agg(distinct m.user_id) into v_to
        from public.club_memberships m
       where m.club_id = p_club_id and m.state = 'ACTIVE'
         and (internal.capability_decision(m.user_id, 'finance.subscription.configure', 'club', p_club_id, null, null, false, false)).allowed;
      if v_to is not null and cardinality(v_to) > 0 then
        select cd.name into v_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = p_club_id;
        insert into public.notifications (user_id, type, title, body, data)
        select r, 'membership_gocardless_verified', 'GoCardless account verified',
               format('GoCardless has verified %s''s account. You can now switch Club Memberships on.', coalesce(v_club_name, 'the club')),
               jsonb_build_object('club_id', p_club_id)
          from unnest(v_to) r;
      end if;
    end if;
  end if;
end;
$function$;

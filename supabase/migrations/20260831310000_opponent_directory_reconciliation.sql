-- Reconciliation for fixture requests made against a canonical-but-not-yet-
-- activated opponent club (fixture_request_groups.opponent_directory_id,
-- already supported since 20260831092000 -- this migration only adds the
-- missing "what happens when that club later activates" step). Fires
-- whenever a new public.clubs row is created (club claim approval today;
-- deliberately a trigger on clubs itself, not baked into
-- approve_club_claim, so any future activation path gets the same
-- reconciliation for free). Uses stable canonical directory_id/club_id
-- matching throughout -- never fuzzy club-name matching -- and never
-- creates a duplicate fixture: it only links the existing request group to
-- the newly-activated club and notifies that club's real officials about
-- the already-existing outstanding request, exactly once.

create function internal.reconcile_opponent_directory_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_request record;
  v_recipient uuid;
  v_requesting_club_name text;
begin
  for v_group in
    select id, requesting_club_id, raw_opponent_text, proposed_date
    from public.fixture_request_groups
    where opponent_directory_id = new.directory_id and opponent_club_id is null
  loop
    update public.fixture_request_groups set opponent_club_id = new.id where id = v_group.id;

    select cd.name into v_requesting_club_name
    from public.clubs c join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id;

    for v_request in
      select id, requesting_team_id from public.fixture_requests where group_id = v_group.id and status = 'sent'
    loop
      for v_recipient in
        select cm.user_id
        from public.club_memberships cm
        where cm.club_id = new.id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
          v_recipient,
          'fixture_request_received',
          'Outstanding fixture request',
          format('%s proposed a fixture on %s, from before your club activated Ovalball.', coalesce(v_requesting_club_name, 'A club'), to_char(v_group.proposed_date, 'DD Mon YYYY')),
          jsonb_build_object('fixture_request_id', v_request.id, 'group_id', v_group.id)
        );
      end loop;
    end loop;
  end loop;

  return new;
end;
$$;

comment on function internal.reconcile_opponent_directory_requests() is
  'Links any fixture_request_groups.opponent_directory_id-only request to a newly-activated clubs row (stable id match, never fuzzy name) and notifies its real CLUB_ADMIN/FIXTURE_SECRETARY officials about outstanding sent requests. Never fabricates a fixture or a user; runs once per activation via the clubs insert trigger, so no duplicate notification/link can occur.';

-- DEFERRABLE INITIALLY DEFERRED (a constraint trigger, the only kind
-- Postgres allows to defer) -- approve_club_claim creates the clubs row
-- FIRST and the new CLUB_ADMIN's club_memberships row in a LATER
-- statement of the same transaction. A plain AFTER INSERT trigger fires
-- immediately on the clubs insert, before that membership exists, so its
-- own notification loop would always find zero recipients. Deferring to
-- commit time means the whole activation transaction (club + membership)
-- has finished by the time this runs, for approve_club_claim and any
-- future activation path alike.
create constraint trigger reconcile_opponent_directory_requests
  after insert on public.clubs
  deferrable initially deferred
  for each row execute function internal.reconcile_opponent_directory_requests();

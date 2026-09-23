-- ===========================================================================
-- THE CLUB HAS SOMETHING TO SAY
-- ===========================================================================
--
-- The review club had no notices and no news, so the Club Notices and Club News
-- sections on both clients collapsed -- correctly, because a club with nothing
-- pinned should not be told so in a column. Correct, and impossible to review:
-- an empty section proves only that it is empty.
--
-- So the review world gets a short, dated NOTICE and two published STORIES,
-- written the way a club actually writes them. Nothing invented about the club
-- itself: the team, the ground and the age grades are the ones already seeded,
-- and every date is relative to the run so the notice is live whenever somebody
-- opens it rather than expiring quietly next month.
--
-- WHY IT IS ONE NOTICE AND TWO STORIES. Enough to show the shape -- the priority
-- treatment, a lead story with its own picture slot, a second in the list
-- beneath -- and not so much that Home becomes a newspaper. A review fixture
-- should look like a club's ordinary week.
--
-- IDEMPOTENT, and it never touches a row somebody has edited: each insert is
-- guarded on its own slug or title.
-- ===========================================================================

do $$
declare
  v_club uuid;
  v_u12  uuid;
  v_author uuid;
begin
  select c.id into v_club
    from public.clubs c join public.club_directory d on d.id = c.directory_id
   where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then
    raise notice 'SKIPPED: the Ovalball UAT club is not seeded yet.';
    return;
  end if;

  select t.id into v_u12 from public.teams t
   where t.club_id = v_club and t.age_group = 'U12' and t.squad_designation is null and t.active limit 1;

  -- Written by the club's own admin persona, because a notice has an author and
  -- an audit trail rather than appearing from nowhere.
  select u.id into v_author from auth.users u where u.email = 'uat.coach@ovalball.test';

  -- ---------------------------------------------------------------------
  -- A NOTICE. Short, dated, and the kind of thing that is actually pinned:
  -- a change somebody needs before Sunday.
  -- ---------------------------------------------------------------------
  insert into public.club_announcements
    (club_id, team_id, title, body, priority, status, visibility, starts_at, expires_at, link_label, link_url, created_by, published_by, published_at)
  select v_club, v_u12,
         'Car park closed for resurfacing',
         'The main car park is closed this weekend. Please use the overflow entrance on Holden Road and allow an extra ten minutes before kick-off.',
         'IMPORTANT', 'PUBLISHED', 'MEMBERS',
         now() - interval '1 day', now() + interval '21 days',
         null, null, v_author, v_author, now() - interval '1 day'
  where not exists (
    select 1 from public.club_announcements a
     where a.club_id = v_club and a.title = 'Car park closed for resurfacing');

  -- ---------------------------------------------------------------------
  -- THE NEWS. One the club has chosen to lead with, and one behind it.
  -- ---------------------------------------------------------------------
  insert into public.club_articles
    (club_id, team_id, slug, title, excerpt, body, category, status, visibility, featured, created_by, published_by, published_at, first_published_at)
  select v_club, v_u12,
         'under-12s-head-to-wigan-for-the-lancashire-cup',
         'Under 12s head to Wigan for the Lancashire Cup',
         'A first-round tie away from home, and the squad travels together from the clubhouse.',
         E'The Under 12s travel to Wigan on Sunday for their opening Lancashire Cup tie.\n\nThe coach leaves the clubhouse at 8am and we would ask everybody to be there by quarter to. Kit as normal, plus a change of clothes and something warm for the sideline -- it is exposed up there.\n\nParents travelling separately: the ground has its own car park off the A49 and there is a tea bar open from nine.',
         'NEWS', 'PUBLISHED', 'PUBLIC', true,
         v_author, v_author, now() - interval '2 days', now() - interval '2 days'
  where not exists (
    select 1 from public.club_articles a
     where a.club_id = v_club and a.slug = 'under-12s-head-to-wigan-for-the-lancashire-cup');

  insert into public.club_articles
    (club_id, team_id, slug, title, excerpt, body, category, status, visibility, featured, created_by, published_by, published_at, first_published_at)
  select v_club, null,
         'clubhouse-kitchen-reopens-on-sunday',
         'Clubhouse kitchen reopens on Sunday',
         'Bacon barms are back, and the volunteer rota for the rest of the season is on the noticeboard.',
         E'The kitchen reopens this Sunday after the summer.\n\nWe are short of two volunteers for October. If you can spare an hour before or after your own side plays, add your name to the rota by the bar -- it makes the difference between a hot drink at half time and a cold one.',
         'UPDATE', 'PUBLISHED', 'PUBLIC', false,
         v_author, v_author, now() - interval '6 days', now() - interval '6 days'
  where not exists (
    select 1 from public.club_articles a
     where a.club_id = v_club and a.slug = 'clubhouse-kitchen-reopens-on-sunday');

  raise notice 'Ovalball UAT RUFC -> % live notice(s), % published article(s)',
    (select count(*) from public.club_announcements a where a.club_id = v_club and a.status = 'PUBLISHED'),
    (select count(*) from public.club_articles ar where ar.club_id = v_club and ar.status = 'PUBLISHED');
end $$;

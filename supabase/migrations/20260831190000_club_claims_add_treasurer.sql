-- club_claims_claimed_role_eligible (20260831180000) deliberately left
-- Treasurer out of the initial claim-eligible allow-list: the brief that
-- introduced the constraint named five roles explicitly plus "Committee
-- Member" for the general back-office case, and Treasurer wasn't one of
-- them -- correctly treated as a human product decision to confirm rather
-- than a role to silently fold in. That decision is now made explicitly:
-- Treasurer is a genuine senior club-officer position with standing to
-- act on the club's behalf, so it joins the allow-list. Safeguarding /
-- Welfare Officer is deliberately still excluded -- it's an important
-- role, but child-protection responsibility is not evidence of authority
-- to set up the club's official Ovalball account, and conflating the two
-- is exactly the mistake this whole eligibility check exists to prevent.
--
-- Forward-only: drops and recreates the constraint rather than editing
-- 20260831180000 in place, so the migration history stays an honest
-- record of what was actually decided and when.
alter table public.club_claims
  drop constraint club_claims_claimed_role_eligible;

alter table public.club_claims
  add constraint club_claims_claimed_role_eligible check (
    claimed_role in (
      'Club Chair / Chairman / Chairperson',
      'Club Secretary',
      'Fixture Secretary',
      'Club Administrator',
      'Director of Rugby',
      'Committee Member',
      'Treasurer'
    )
  );

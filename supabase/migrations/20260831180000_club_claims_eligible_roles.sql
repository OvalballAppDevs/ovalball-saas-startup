-- Nothing has ever restricted who can submit an unclaimed-club claim --
-- club_claims_insert_self's WITH CHECK is only `claimant_user_id =
-- auth.uid()`, and claimed_role is free text with no allow-list. Any of the
-- 15 real-world roles offered at signup (Coach, Team Manager, Player,
-- Parent/Guardian, Volunteer included) could submit a claim, which --
-- once approved -- grants full CLUB_ADMIN over that club. A person's
-- day-to-day role at a club is not evidence they have authority to set up
-- its official account.
--
-- This is enforced here, not just in the UI: a CHECK constraint is the
-- actual security boundary (matches this schema's consistent pattern of
-- RLS/constraints being authoritative, never client-side filtering alone).
-- The allow-list below is deliberately narrow and matches the roles named
-- in the product brief -- Chair, Secretary, Fixture Secretary, Club
-- Administrator, Director of Rugby -- plus "Committee Member" as the
-- closest existing CLUB_ROLES label to the brief's own "appropriate Back
-- Office / Committee Administrator role" clause. Treasurer and
-- Safeguarding/Welfare Officer were deliberately left out of this list --
-- not because they can't reasonably be trusted, but because the brief
-- didn't name them and this is exactly the kind of judgment call that
-- should be confirmed by a human rather than silently expanded. Anyone
-- excluded here can still be invited into the club by its Club Admin once
-- an eligible person has completed the claim -- this restricts who can
-- START an unclaimed club's account, not who can ever hold authority on
-- Ovalball.
alter table public.club_claims
  add constraint club_claims_claimed_role_eligible check (
    claimed_role in (
      'Club Chair / Chairman / Chairperson',
      'Club Secretary',
      'Fixture Secretary',
      'Club Administrator',
      'Director of Rugby',
      'Committee Member'
    )
  );

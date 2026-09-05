# Legal & Owner Review Required

The public Legal & Trust pages at `/legal` are written, published and factually
accurate to the current implementation. This file lists **only genuinely unresolved
items** — things that were deliberately not written onto public pages because doing so
would have meant inventing them.

Nothing below blocked publication. Each is an improvement to make, not a gap that makes
the current pages wrong.

## A. Company information — OWNER INPUT REQUIRED

None of these appear anywhere on the public site, because none is verified.

| Item | Status | Where it would go |
|---|---|---|
| Companies House registration number | **Not supplied** | Footer / Terms / Privacy "Who we are" |
| Registered office address | **Not supplied** | Privacy "Who we are", Terms |
| VAT number | **Not supplied** | Terms, and payment documentation if VAT applies |
| ICO registration number | **Not supplied** | Privacy "Who we are" |
| Whether a DPO is appointed | **Not determined** | Privacy contact section |
| Privacy / data-protection contact address | **Not supplied** | Every page's contact section |

Pages currently direct readers to `/public-support`, which is a real login-free route.
That is honest and workable, but a dedicated privacy contact address is the normal
expectation and Meta/Google reviewers may look for one.

## B. Solicitor review — SOLICITOR REVIEW REQUIRED

1. **Controller / processor allocation.** The Privacy Notice deliberately says the club
   and the operator may have different responsibilities depending on the information,
   rather than asserting a single controller. The precise allocation, and whether a data
   processing agreement is needed between the operator and each club, needs a lawyer.
2. **Lawful bases.** The table in Privacy §21 reflects how the system works. Confirm each
   entry, particularly the reliance on legitimate interests for children's information,
   and complete a Legitimate Interests Assessment.
3. **Children's processing.** Confirm the approach to age-grade processing, guardian
   permissions and any age-verification expectations under the Children's Code.
4. **Special-category data.** The service does not currently hold health or medical
   information. If injury or medical fields are added later, that is Article 9 data and
   this position must be revisited before launch of that feature.
5. **Liability and consumer position.** Terms §17–18 are drafted conservatively. Confirm
   the limitation of liability, and whether club users are business or consumer
   contracts — the answer changes what may lawfully be limited.
6. **Safeguarding language.** Confirm the division of responsibility stated on
   `/legal/safeguarding` matches what governing bodies expect of a technology supplier.
7. **Payment and subscription terms.** Before live payment collection is enabled, confirm
   cancellation rights, refunds and the club-versus-operator contractual position.

## C. Retention — OWNER + LEGAL DECISION

The Privacy Notice describes retention by principle and explains which records are
deliberately durable (fixtures, results, audit entries, eligibility decisions). It does
**not** state specific periods, because none has been decided. Inventing "we delete after
30 days" would have been false.

Decide and then publish concrete periods for: closed accounts, ended team memberships,
messages, audit log entries, financial records (statutory minimum likely applies),
and player records after a player leaves a club.

## D. International transfers — CONFIRM AND THEN STATE

Both pages say transfers may occur outside the UK under an appropriate safeguard, and
deliberately do **not** name a region. Confirm the actual Supabase and Vercel region
configuration, then state it. Do not claim UK-only unless it is true and enforced.

## E. Before enabling social sign-in

The Privacy Notice and Third-Party Services page currently say Google, Facebook and Apple
sign-in are *supported but not enabled*. When any is enabled, update both pages in the
same change — leaving them saying "not enabled" once it is live would make the notice
inaccurate.

Same applies to GoCardless: both pages state live payment collection is disabled in
production.

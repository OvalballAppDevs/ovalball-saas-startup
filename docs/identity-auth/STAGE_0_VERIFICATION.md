# Stage 0 — read-only verification

**Result: NOT SATISFIED.** Step 5 is stopped before implementation, as the
authorisation requires. Nothing was changed in production and nothing was
compensated for in application code.

Checked against the linked production project (confirmed by its own shape: one
club, four users, four profiles — the live dataset, not a local one). Read-only
`select` only; no secret, factor payload, code or token was read or printed.

---

## What the design asks for

| Stage 0 step | Owner | Required state |
|---|---|---|
| 0.1 | Platform owner | TOTP enrol **and** verify enabled in the production Auth settings, max factors 3 |
| 0.2 | Platform owner | The existing Full Site Admin enrols through `/account/security` |
| 0.3 | Claude | Read-only confirmation that the factor exists, is verified, and enforcement is still off |

## What production actually holds

| | |
|---|---|
| `auth.mfa_factors` — total rows | **0** |
| — verified | **0** |
| — verified TOTP | **0** |
| People with any verified factor | **0** |
| Active Site Admins | 1 |
| `security_events` mentioning mfa / factor / totp | **none at all** |

**There is no factor row of any kind — not even an unverified one.** Enrolment
creates the row first and verification confirms it, so a half-finished enrolment
would still leave an unverified row behind. Nothing is there, and no security
event was written either, so the enrolment did not reach the server.

The two readings that fit are that the Auth setting did not actually save, or
that the enrolment flow failed before creating the factor. Both are in the
dashboard and in the owner's hands; neither is an application defect I can see
from here.

## The reassuring half

Enforcement is **still off**, exactly as T0 requires, so nothing is locked out:

| enforcement group | `require_aal2_from` | `grace_until` | `block_magic_link_login` |
|---|---|---|---|
| NONE, FAMILY, MINOR, PLAYER, PRIVILEGED, STAFF | `null` | `null` | `false` |

Had enforcement been switched on while zero factors existed, every privileged
account would have been locked out. It was not.

## Why this stops Step 5

Every Q.3 master-control RPC passes through
`internal.master_control_preamble` → `internal.require_recent_aal2(interval '10 minutes')`.
With zero verified factors, no one — including the Full Site Admin — can satisfy
it. Slice 7e's positive authority path therefore cannot be exercised at all, and
the programme does not accept denial-only coverage as authority coverage.

The authorisation is explicit: *"If Stage 0 is NOT actually satisfied: STOP. Do
not compensate in application code."* So nothing was weakened, no window was
lengthened, no bypass was added.

## To unblock

1. In the Supabase dashboard → Authentication → **confirm TOTP enrol and verify
   are enabled and saved**, with max enrolled factors 3.
2. Enrol the Full Site Admin at `/account/security` and **complete the verify
   step** — the six-digit code — not just the QR scan.
3. Ask for re-verification. It is read-only and takes one query.

If enrolment fails at the app rather than silently doing nothing, say what the
screen showed: that is a different problem and it would be mine.

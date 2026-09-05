"use client"

import Link from "next/link"

import {
  AUTHORITY_DECLARATION_TEXT,
  type SelectedTeam,
  type SignupFormState,
} from "@/lib/signup/types"
import { CURRENT_TERMS_VERSION } from "@/lib/signup/terms"

interface ReviewStepProps {
  value: SignupFormState
  onTermsChange: (accepted: boolean) => void
  onEditStep: (step: "account" | "details" | "club") => void
}

export function ReviewStep({ value, onTermsChange, onEditStep }: ReviewStepProps) {
  const { personal, club } = value

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          Step 4
        </p>
        <h1 className="mt-2 font-display text-display-l text-ink">Review</h1>
        <p className="mt-3 text-base text-ink/60">
          Check everything below, then accept the terms to finish.
        </p>
      </div>

      <ReviewCard title="Your account" onEdit={() => onEditStep("account")}>
        <ReviewRow label="Email" value={value.email} />
      </ReviewCard>

      <ReviewCard title="Your details" onEdit={() => onEditStep("details")}>
        <ReviewRow label="Name" value={`${personal.firstName} ${personal.surname}`.trim()} />
        <ReviewRow label="Date of birth" value={personal.dateOfBirth} />
        <ReviewRow
          label="Address"
          value={[
            personal.addressLine1,
            personal.addressLine2,
            personal.addressLine3,
            personal.town,
            personal.county,
            personal.postcode,
            personal.country,
          ]
            .filter(Boolean)
            .join(", ")}
        />
      </ReviewCard>

      <ReviewCard title="Your club" onEdit={() => onEditStep("club")}>
        {club.kind === "existing-unclaimed" && (
          <>
            <ReviewRow label="Claiming" value={club.directory.name} />
            <ReviewRow label="Teams" value={formatTeams(club.teams)} />
          </>
        )}
        {club.kind === "existing-claimed" && (
          <ReviewRow label="Requesting access to" value={club.directory.name} />
        )}
        {club.kind === "not-found" && (
          <>
            <ReviewRow label="Proposing new club" value={club.proposal.clubName} />
            <ReviewRow label="Teams" value={formatTeams(club.teams)} />
          </>
        )}
        {club.kind === "unselected" && (
          <p className="text-sm text-ink/50">No club selected yet.</p>
        )}
      </ReviewCard>

      {(club.kind === "existing-unclaimed" || club.kind === "existing-claimed") && (
        <ReviewCard title="Your role" onEdit={() => onEditStep("club")}>
          <ReviewRow label="Role at the club" value={club.role} />
        </ReviewCard>
      )}

      {club.kind === "existing-unclaimed" && (
        <ReviewCard title="Authority declaration" onEdit={() => onEditStep("club")}>
          <p className="text-sm text-ink/70">
            {club.authorityConfirmed ? (
              <>&ldquo;{AUTHORITY_DECLARATION_TEXT}&rdquo;</>
            ) : (
              <span className="text-destructive">Not yet confirmed.</span>
            )}
          </p>
          <p className="mt-2 text-sm text-ink/45">
            This does not grant access on its own &mdash; Ovalball may verify
            your authority before approving the claim.
          </p>
        </ReviewCard>
      )}

      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">
          Terms
        </p>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={value.termsAccepted}
            onChange={(event) => onTermsChange(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-pitch-600"
          />
          <span className="text-ink/70">
            I accept the{" "}
            <Link
              href="/legal/terms"
              target="_blank"
              className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
            >
              Terms and Conditions
            </Link>{" "}
            (version {CURRENT_TERMS_VERSION}).
          </span>
        </label>

        {/* Acknowledging a privacy notice is NOT consent, so this is
            deliberately plain text below the controls rather than a second
            tickbox -- and never a pre-ticked one. */}
        <p className="mt-3 text-sm text-ink/60">
          By creating an account, you agree to the Ovalball{" "}
          <Link href="/legal/terms" target="_blank" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
            Terms of Service
          </Link>{" "}
          and acknowledge the{" "}
          <Link href="/legal/privacy" target="_blank" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
            Privacy Notice
          </Link>
          . If you are signing up as a parent or guardian, see{" "}
          <Link href="/legal/children-privacy" target="_blank" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
            Children&rsquo;s Privacy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

function ReviewCard({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">
          {title}
        </p>
        <button
          type="button"
          onClick={onEdit}
          className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
        >
          Edit
        </button>
      </div>
      <dl className="mt-3 flex flex-col gap-2">{children}</dl>
    </section>
  )
}

function formatTeams(teams: SelectedTeam[]): string {
  if (teams.length === 0) return ""
  return teams
    .flatMap((t) =>
      t.additionalLetters.length > 0
        ? [t.category, ...t.additionalLetters.map((letter) => `${t.category} ${letter}`)]
        : [t.category]
    )
    .join(", ")
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <dt className="text-ink/45">{label}</dt>
      <dd className="text-ink">{value || <span className="text-ink/35">&mdash;</span>}</dd>
    </div>
  )
}

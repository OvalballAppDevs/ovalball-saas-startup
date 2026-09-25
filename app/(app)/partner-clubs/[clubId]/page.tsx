import { redirect } from "next/navigation"

/** Same redirect as the parent route -- see app/(app)/partner-clubs/page.tsx. */
export default async function PartnerClubDetailRedirect({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params
  redirect(`/clubhouse/${clubId}`)
}

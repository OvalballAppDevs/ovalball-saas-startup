import { redirect } from "next/navigation"

export default async function CompetitionEditionPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params
  redirect(`/fixtures/competitions/${editionId}/participants`)
}

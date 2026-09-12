import { redirect } from "next/navigation"

/**
 * IMPORTING FIXTURES IS PLANNING FIXTURES.
 *
 * This route used to be a separate upload-a-file page: choose a CSV, submit
 * it, wait, then meet your season for the first time on a staging review
 * screen you could not type into. Two surfaces, two mental models, and the
 * file route was the worse one -- a club could not see what Ovalball had
 * understood until after it had committed to the upload.
 *
 * The Mass Fixture Planner does the same job better and does it in one
 * place: the file lands in the grid, every row is matched against the same
 * canonical records, and the person corrects it in the cells before
 * anything is created. So "Import Fixtures" and "Plan Fixtures" are the
 * same destination, because they are the same job.
 *
 * The route is kept rather than deleted because links to it exist -- in
 * the product, in notification bodies and in people's bookmarks -- and a
 * dead link is a worse answer than a redirect. `/fixtures/import/[batchId]`
 * is deliberately untouched: reviewing a batch that has ALREADY been staged
 * is a different job from creating one, and it is still reachable.
 */
export default async function ClubImportFixturesPage() {
  redirect("/fixtures/planner")
}

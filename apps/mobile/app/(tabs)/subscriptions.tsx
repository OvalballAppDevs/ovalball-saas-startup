import { DestinationFoundation } from "../../src/components/destination"
import { Receipt } from "../../src/components/icons"
import { colour } from "../../src/design/tokens"

/**
 * Reached from the bottom bar only by somebody the SERVER says holds `finance.subscription.view` at
 * team scope, and from More by everybody else. The route exists either way: hiding a tab removes a
 * shortcut, never an authority, and this page will re-check when it reads anything real.
 */
export default function Subscriptions() {
  return (
    <DestinationFoundation
      icon={<Receipt size={30} color={colour.forest800} strokeWidth={1.9} />}
      title="Subscriptions"
      intro="Whether each player in your squad is set up to pay. Payments themselves are handled by the club."
      willHold={[
        "Who is paid, due, failed or not set up yet",
        "Chasing the ones that need chasing, without leaving the app",
        "For a parent: what you owe and when it goes out",
      ]}
      webPath="/dashboard"
      webLabel="Open Subscriptions on the Web"
    />
  )
}

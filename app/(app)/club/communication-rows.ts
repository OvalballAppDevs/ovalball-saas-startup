// Shared between the Club page (a server component, which reads the policy
// values) and the panel that renders them. Deliberately NOT inside the
// "use client" module: a server component importing a value from a client
// module receives a client reference rather than the array itself, which
// fails only at request time.

export interface CommunicationRowDefinition {
  key: string
  label: string
  description: string
  conjunction: boolean
}

/**
 * The settings Ovalball delegates, and how each is described to a club. The
 * wording matches Site Admin deliberately: the same capability must not have
 * two names depending on who is looking at it.
 */
export const COMMUNICATION_ROWS: CommunicationRowDefinition[] = [
  {
    key: "allow_direct_messaging",
    label: "Direct Messaging",
    description:
      "Eligible adult members may send person-to-person messages. People under 18 cannot use direct messaging, whatever their role, and personal blocks always apply.",
    conjunction: true,
  },
  {
    key: "allow_team_conversations",
    label: "Team Conversations",
    description: "A team may run a standing conversation its families can read and post in.",
    conjunction: false,
  },
  {
    key: "allow_multi_person_conversations",
    label: "Chosen Groups",
    description: "Messaging a specific group of people rather than a whole team or club.",
    conjunction: false,
  },
  {
    key: "allow_team_announcements",
    label: "Team Announcements",
    description: "A team announcing to its own families.",
    conjunction: false,
  },
  {
    key: "allow_club_announcements",
    label: "Club Announcements",
    description: "The club announcing to everybody it runs.",
    conjunction: false,
  },
  {
    key: "allow_private_replies",
    label: "Private Replies",
    description: "A recipient may answer an announcement, seen only by the sending side.",
    conjunction: false,
  },
  {
    key: "allow_group_discussion",
    label: "Group Discussion",
    description:
      "Everyone who received a team or chosen-group announcement can talk to each other. Never available for a club-wide audience.",
    conjunction: false,
  },
]

import "server-only"

/**
 * The one canonical rule for a club's public profile text, exactly
 * mirroring resolveClubLogoPath's rule for its crest: the activated club's
 * own value wins, and the Club Directory's value is the seed underneath it
 * for a club that has not written its own (or has not claimed itself at
 * all).
 *
 * Both tables genuinely hold these fields. `clubs.bio` / `clubs.website` /
 * `clubs.facebook_url` are what a Club Admin edits in Club Settings.
 * `club_directory.bio` / `.website` / `.facebook_url` are what a Site Admin
 * maintains for any recognised club, claimed or not. Nothing is copied
 * between them and there is no sync step -- the choice is made here, at
 * read time, so a club that claims itself later and writes its own bio
 * simply starts winning without anything having to be migrated.
 *
 * Empty strings are treated as absent. A club that clears its bio should
 * fall back to the directory's, not display a blank where a description
 * exists one level down.
 */
export interface ClubPublicProfileSource {
  bio?: string | null
  website?: string | null
  facebook_url?: string | null
  club_directory?: {
    bio?: string | null
    website?: string | null
    facebook_url?: string | null
  } | null
}

export interface ClubPublicProfile {
  bio: string | null
  website: string | null
  facebookUrl: string | null
  /** Which layer each value came from -- for Site Admin surfaces that need to say so. */
  source: {
    bio: "club" | "directory" | "none"
    website: "club" | "directory" | "none"
    facebookUrl: "club" | "directory" | "none"
  }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function pick(
  own: string | null | undefined,
  directory: string | null | undefined
): { value: string | null; source: "club" | "directory" | "none" } {
  const mine = clean(own)
  if (mine) return { value: mine, source: "club" }
  const theirs = clean(directory)
  if (theirs) return { value: theirs, source: "directory" }
  return { value: null, source: "none" }
}

export function resolveClubPublicProfile(club: ClubPublicProfileSource | null | undefined): ClubPublicProfile {
  const bio = pick(club?.bio, club?.club_directory?.bio)
  const website = pick(club?.website, club?.club_directory?.website)
  const facebookUrl = pick(club?.facebook_url, club?.club_directory?.facebook_url)

  return {
    bio: bio.value,
    website: website.value,
    facebookUrl: facebookUrl.value,
    source: { bio: bio.source, website: website.source, facebookUrl: facebookUrl.source },
  }
}

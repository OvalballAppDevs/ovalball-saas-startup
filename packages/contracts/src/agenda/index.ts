/**
 * ONE CANONICAL EVENT TRUTH, FOR EVERY SURFACE THAT SHOWS RUGBY.
 *
 * Home, Fixtures and Calendar on a phone, and the Agenda, Team pages and Calendar in a browser, all
 * answer versions of the same question: what rugby is happening, for whom, and when. They must not
 * answer it separately.
 *
 * THIS IS THE DEBT THE MOBILE FOUNDATION RECORDED, PAID. `apps/mobile/src/context/home-data.ts` said
 * plainly that it was NOT the canonical agenda -- it asked one team for its next fixture, because
 * `lib/agenda/load.ts` depended on `server-only` and on a React component's props type and could not be
 * reached from React Native. Home therefore resolved an opponent by its own small rule, while the
 * website resolved it by the canonical one. Two answers to "who are we playing" is a defect waiting for
 * a fixture whose opposition is a directory entry rather than a team.
 *
 * WHAT MOVED, AND WHAT DID NOT. The loader, the scope resolver, the date window and the filters moved
 * here unchanged. `server-only` stayed on the web side, because it was always a BUNDLING directive
 * rather than a secret: these functions take an already-authenticated client and hold nothing
 * privileged, so a browser component that reaches for them still fails exactly as it did, while React
 * Native -- which has no such boundary -- imports the package.
 *
 * WHAT THIS IS NOT. It is not a view model. The loader returns rugby facts -- both sides, home or away,
 * kick-off, meet time, venue, status, result, the child a row belongs to -- and each surface projects
 * them for its own ergonomics. A phone's Fixtures list and a browser's agenda table may look nothing
 * alike; they may not disagree about who is playing whom.
 */

export * from "./filters"
export * from "./family-scope"
export * from "./kit"
export * from "./load"
export * from "./mirror-pair"
export * from "./opposition"
export * from "./scope"
export * from "./team-identity"
export * from "./window"

# Den & Desk — Phase 3 (working name)

**For consenting adults in roleplay.**

Phase 3 is built locally on top of Phase 2. Nothing is deployed,
published to GitHub, or opened to registration. See "Hosting status"
and "Publishing to GitHub" below for the exact blockers.

## What Phase 3 adds

- **Pet routine + owner commands**: owner commands on active
  contracts only — Come home, Bedtime, Cage time (framed as cozy
  den / quiet time, never confinement punishment), Eat, Walk, Potty
  break. The pet answers Done, Need help, or Pass (excused). A daily
  pet-care routine template — Eat, Walk, Potty, Nap, Play — as
  checkable items for the day, with Pass excused and no streak
  pressure. Commands never override a safeword, pause, block, or
  contract end.
- **Den login animation (frontend only)**: on successful email-code
  login, a short den-door opening (under 1 second, no sound by
  default, instant if prefers-reduced-motion is set), with a
  different short cue for Owner ("The Desk opens the Den.") vs Pet
  ("Welcome home to the Den."). No new data stored, no auth change.
- **Gear wishlist (no purchases)**: add, view, and remove items from
  a fixed list (collar, leash, outfit, den/cage, toy, other) plus a
  free-text label. No prices, no checkout, no external shop links,
  no payment. Private by default; a contract partner sees only
  items the user chose to share.
- **Safe lost-pet mode (safety-critical, read this carefully)**:
  lost mode is separately opt-in by the pet — an owner can only
  start it when the pet has opted in, and a pet turning it on
  themselves counts as opting in. The pet can end it instantly
  (check in as home, turn it off, safeword, contract pause/end, or
  turn opt-in off, which closes open alerts at once). A "Lost pets"
  board lists lost pets by pseudonym and pet type only, plus a
  general-area label the user typed themselves (never a street
  address — an address-looking value is rejected — never a precise
  location, never auto-detected). **No browser geolocation, GPS,
  watchPosition, or real-distance calculation anywhere in this
  phase.** A helper's only actions are in-app: "I think I found
  them" marks the alert found in-app and sends an in-app message to
  the original owner only; the helper gets no location, phone, or
  private detail, and is never told to meet the pet in person.
  "Brought home" / "transported home" means only: found marked
  in-app, owner confirmed, pet checked in as home. The original
  owner, or the pet themselves, is the only person who physically
  moves the pet, and only if already agreed separately. Lost alerts
  are never public outside registered, logged-in users, never
  indexed, and blocked pairs cannot see or message about each
  other's alerts.
- **Digital lost poster**: when lost mode is on, each board entry is
  a poster card — "LOST — Please find my cat/dog" — with pseudonym
  and pet type only, the general-area label, the distinct app sound
  option, and a reward line. Reward options are only: a Good Finder
  badge/sticker in-app, a thank-you note, a treat for the finder's
  own pet, or a wishlist gift between people who already know each
  other. No cash, no payment, no real contact details on the poster.
  No QR or tag links to a real identity. The poster pulses gently
  on the board and on the stylised in-app game board (not a real
  street map, not a real-world dot); with prefers-reduced-motion it
  is static.
- **Proximity sound in game mode only**: users check into an
  in-game play area by typing its label, or move their game token
  to another label. When a finder and a lost pet are in the same
  play-area label, the finder's phone can play the distinct app
  sound — but only while lost-game mode is on, only when the pet
  has not muted it (pet-controlled, mutable at any time), and only
  when the finder's own device toggle is on. The sound is a short
  synthesised in-app notification tone, played only on a button
  press, never autoplayed, never broadcast in public by default,
  and never triggered by real location.
- **Caught protocol (shown in the lost-mode UI)**: DO ask first
  in-app, respect the safeword instantly, stop if the pet is out of
  headspace or distressed, contact the original owner in-app first,
  and let the original owner confirm. DO NOT follow, touch without
  consent, share a photo or location, approach a pet who is alone
  and distressed, or transport a person in a vehicle.
- **Good/bad praise (private)**: within an active contract, the
  owner can send a praise note ("Good kitten", "Good dog") or a
  gentle correction note. Notes are private between the pair, no
  public shaming, no financial punishment, and safeword / pause /
  block still override everything.
## Test/dev slice: Postgres storage, SMTP code, pet-sitting

**TEST/DEV ONLY, FREE ONLY.** This slice is for testing and
developing only — not a production launch, not for real users, not
an open beta, no invites sent. No payment, paid plan, paid provider,
card, subscription, or converting trial is used anywhere, and even
after a polished product exists, payment is a separate future user
decision — never automatic, never assumed. If any step in
DEPLOY.md asks for payment, STOP and report it as blocked.

- **Phase 3 Postgres storage (gap closed in code, live test still
  owed)**: real tables and adapter queries in `api/src/db/schema.sql`
  and `api/src/db/postgres.ts` for owner commands, routine items,
  wishlist items, lost alerts + lost settings + game-area tokens,
  and praise notes. The previous "stubs that throw" are gone.
  Honest limit: this was verified only against a mock Pool in
  unit tests (SQL strings + row mapping) plus schema review — no
  Postgres server was available in this build environment, so a
  live test against a free test DATABASE_URL is still required
  before any shared test deployment. See DEPLOY.md.
- **SMTP email delivery (code only, no provider, no real send)**:
  a dependency-free SMTP client in `api/src/email.ts`, driven only
  by SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM.
  If SMTP is not configured, login-code requests fail loudly with
  503 and no code is stored, sent, or logged. The local dev code
  path stays local-only, off by default (ALLOW_DEV_CODE must be
  explicitly 'true'), and refused in production. No real email was
  sent in this build; unit tests use a local fake SMTP server only.
- **Pet-sitting (temporary, bounded sits)**: an original owner posts
  a sitting request on an active contract (dates, routine summary,
  limits, safeword note — no home address, no keys, ever); a sitter
  applies; BOTH owner and pet must agree before the sit starts;
  the sitter then runs day-to-day routine / commands / check-ins
  for the bounded window only; the sitter cannot change the main
  contract, cannot extend the sit (no extend endpoint exists), and
  cannot contact the pet after it ends unless the pet agrees
  separately; the original owner can reclaim instantly, the pet can
  pause or end instantly, control auto-returns at expiry, a
  handover report is recorded at the end, and a sitter trust badge
  is awarded only after a completed sit with no safety report.
  Blocked pairs cannot sit for each other. 18+ adults only.
- **DEPLOY.md**: the exact remaining steps for a live test service,
  in order — free-tier API host sign-in (user step), free test
  Postgres, free-tier SMTP env vars, MODERATOR_EMAILS, INVITE_CODES,
  and the still-open age-assurance budget decision — each marked
  STOP on any payment demand. Production launch is a separate
  future user decision.

## What Phase 2 adds

- **Contract builder with mutual signing**: a contract between exactly
  two users starts as a draft (title, limits, safeword — a safeword of
  1 to 40 characters is required) and becomes active only when BOTH
  sides sign it. Either side can pause it; a safeword stops it at once
  (paused, with the time recorded); resuming needs BOTH sides to
  confirm, so one side cannot restart it alone after a stop. Ending a
  contract is terminal and always works, even after a block — ending is
  an escape, not a continuation. A block between the parties stops new
  contract activity, but never stops ending, pausing, or a safeword.
- **Duties/tasks with check-ins and owner approval**: duties are
  created on active contracts only, assigned to one of the parties.
  The assignee submits with a written proof note (1 to 500 characters);
  the other party approves or declines it. Declining returns the duty
  to open with the proof cleared and a review note kept. An approved
  duty can receive exactly one reward (title, granted by a party).
  Honest limit: Phase 2 has NO photo upload or storage — a "proof"
  check-in is a written note (for example describing the photo the
  assignee took) that the other party reviews. Photo upload/storage
  is a later phase, and the API and UI never claim a photo was
  uploaded.
- **Bookings (general scheduling)**: bookings on active contracts, with
  start/end times, meeting mode, a general-area region label only
  (never a street address), and a work description. The other party
  confirms or declines a proposed booking; either party can cancel a
  proposed or confirmed booking. This generalises the nikki
  control-panel booking idea as a feature for any owner/pet pair — it
  is not nikki-specific and contains no nikki data.
- **Aftercare plans + nudges, including long-distance aftercare**:
  plans on active or paused contracts, with a closure phrase (for
  example "scene over, welcome back"), up to 10 self-care prompts, and
  a scheduled check-in delay of 0 to 1440 minutes. Aftercare check-ins
  are prompt (due now) or scheduled (due at the plan's delay, or 60
  minutes by default); a due-only listing shows open check-ins whose
  due time has passed; either party can complete one.
- **Long-distance tools**: scheduled check-ins (a due time and a note,
  for the other party, completable by either party) and video-hello
  requests (requested, then accepted or declined by the recipient,
  then completable). Honest limit: a video hello is a request/accept
  flow only — no video call is built in Phase 2 (no WebRTC). The
  parties use their own call tool once a request is accepted, and the
  API and UI never claim a call happened inside Den & Desk.
- **Frontend**: a Dynamics section on the dashboard with contract
  create/sign/safeword/pause/resume/end, duty create/submit/approve/
  decline/reward, booking propose/confirm/decline/cancel, aftercare
  plan and check-in forms and lists, video-hello requests, and
  scheduled check-ins.
- **What did NOT change**: invite-only beta gate stays ON; free core
  forever; no Facebook login; no contact sync; no real-name or
  face-photo requirement; email-code login only; 18+ declaration gate
  only, not real age assurance; explicit content behind login + invite
  gate only; no explicit imagery on public pages; Kitty/Puppy only at
  launch.

## Phase 2 gaps (stated plainly, not solved)

1. **Real email delivery is still NOT wired, and now also needs code,
   not just a provider choice.** Codes are generated, hashed and
   verified, but the `request-code` endpoint still has no SMTP sending
   implemented. Choosing a provider alone will not make it work;
   SMTP sending is a follow-up code change. `ALLOW_DEV_CODE=true`
   returns the code for local testing only and must be `false` in
   production.
2. **Postgres adapter is still NOT live-tested, now including the
   Phase 2 tables.** It is code-complete for contracts, duties,
   rewards, bookings, aftercare plans/check-ins, video hellos and
   scheduled check-ins, but no Postgres server was available and none
   was provisioned. Test it once against a staging `DATABASE_URL`
   before any shared deployment. A database created from the Phase 0/1
   schema needs only the Phase 2 CREATE TABLE statements at the
   bottom of `api/src/db/schema.sql`.
3. **Age assurance is still declaration-only.** No facial estimation
   or ID check was added; that needs a budget decision.
4. **No live deploy, no GitHub remote** — see the blocker sections
   below. No cron job was created; the proposed cron text is still
   for main-agent review only.

## What Phase 1 adds

- **Discovery with real filters** (`GET /api/v1/profiles`): role,
  pet type (Kitty / Puppy only), meeting mode (Online / InPerson /
  Both, exact match), and region (case-insensitive substring of a
  free-form, user-typed region label — never a street address, never
  geocoded). Profiles also carry `meetingMode` and `region` from
  creation. Passed people are hidden from your discovery; blocked
  people are hidden both ways (people you blocked and people who
  blocked you).
- **Like / pass**: like is a discovery signal only; pass hides
  someone from your own discovery only. Passing is NOT a block and is
  not shown to the other person. Use Block to sever contact.
- **Fixed mailbox messaging**: one thread per pair of users, with
  unread counts that clear when a thread is opened. Messaging is
  deliberately NOT match-gated: any two registered, non-blocked users
  can message each other. Likes and passes only shape discovery.
  Messages are 1–2000 characters; blocked pairs cannot message or
  view each other's threads.
- **Mutual-rating trust badges** (Phase 1 subset of the Once Upon a
  Little mutual-rating idea, in concept only — no code or members
  were taken from it): one 1–5 score per direction, re-rating
  replaces the earlier score. A badge counts ONLY mutual ratings
  (the other person rated you back): 1 mutual rater averaging 3.5+
  = "Newly trusted"; 2 averaging 4.0+ = "Trusted"; 3 averaging 4.5+
  = "Highly trusted". Otherwise no badge, even if one-way ratings
  exist. Discovery listings include each profile's trust summary.
- **Safety report queue, moderator-only**: reports are still filed
  by any logged-in user, safety reports flagged urgent, and open
  reports sort urgent-first. The queue itself (`GET
  /api/v1/reports/queue`, plus resolve) is open only to users whose
  email is listed in `MODERATOR_EMAILS` (comma-separated). Until
  that list is set, nobody can view the queue — reports are stored
  but not exposed. Non-moderators get 403. Moderation *staffing*
  (who those emails belong to) is still an open decision for GG Foxy.
- **Frontend**: discovery filter controls, Like / Pass / Message /
  Block on each person card with trust badges shown, a Mailbox
  section with threads and unread counts, a rate-someone form, and a
  moderator-only safety queue section. The landing page no longer
  promises contracts or duties — those are Phase 2, not built yet.
- **What did NOT change**: invite-only beta gate stays ON; free
  core (safety, community, matching, messaging, block/report)
  forever; no Facebook login; no contact sync; no real-name or
  face-photo requirement; email-code login only (Apple/Google stay
  disabled placeholders); 18+ declaration gate only, not real age
  assurance; explicit content behind login + invite gate only; no
  explicit imagery on public pages.

## Phase 1 gaps (stated plainly, not solved)

1. **Real email delivery is still NOT wired.** Codes are generated,
   hashed and verified, but no SMTP provider was chosen or paid
   for. `ALLOW_DEV_CODE=true` returns the code for local testing
   only and must be `false` in production.
2. **Postgres adapter is still NOT live-tested.** It is code-complete
   for all Phase 1 tables, but no Postgres server was available in
   the build environment and none was provisioned. Test it once
   against a staging `DATABASE_URL` before any shared deployment. A
   database created from the Phase 0 schema needs the migration
   notes at the bottom of `api/src/db/schema.sql`.
3. **Age assurance is still declaration-only.** No facial estimation
   or ID check was added; that needs a budget decision.
4. **No live deploy, no GitHub remote** — see the blocker sections
   below. No cron job was created; the proposed cron text is still
   for main-agent review only.

# Den & Desk — Phase 0 (working name)

**For consenting adults in roleplay.**

Den & Desk is a separate pet-play service for owner/pet pairs. It is NOT
Once Upon a Little and NOT the nikki control panel. No code, repo, or
account from those projects was touched to build this.

## What Phase 0 contains

- Vite + React + TypeScript frontend, Node/Express + TypeScript API, JWT auth.
- Landing page whose first line states this is for consenting adults in
  roleplay, plus a plain-language policy page.
- Email-code auth (magic-link style 6-digit code, no password to leak).
  **Email delivery is not yet wired to a real SMTP provider in Phase 0**
  (see below) — codes are generated, hashed, expire in 10 minutes, and are
  verified by the API. In development only, with `ALLOW_DEV_CODE=true`,
  the code is returned by the request endpoint so the flow can be tested
  end to end. That flag must be `false` in any public deployment.
- 18+ date-of-birth declaration gate + email verification. This is a gate,
  not a real age-assurance check. A placeholder secret is never presented
  as a real check. Full age assurance (facial estimation / ID) is a later
  phase and needs a budget decision.
- Invite-only beta gate ON. No open registration. A valid, unused invite
  code is required at signup. Invite codes come from `INVITE_CODES`
  (comma-separated). If unset, the API uses a single development code
  and logs a warning — set real codes before any shared deployment.
- Pseudonymous profiles only. Role: Owner / Pet / Switch / Curious.
  Pet type at launch: Kitty / Puppy only. Other pet types (pony, bunny,
  other) are rejected with a clear message and are a later phase, not
  day one. No real name field. No face photo required.
- Block and report, including a safety category that is flagged urgent.
  Block/report, safety, community, matching and messaging are free core,
  forever. Premium, if ever added, is only later extras such as a
  supporter badge or merch — never paywalled messaging, safety, or
  matching.
- Silent quick exit, always visible: clears the local session and swaps
  to a neutral page without leaving the app in history (replaceState).
- Login rules: email code is primary. Sign in with Apple (private relay)
  is an optional, not-yet-enabled placeholder only. Google is shown only
  with a warning to use a separate account if this identity is private,
  and is not enabled in Phase 0. **Facebook login is never offered.**
  No contact sync, no find-friends, ever.

## Policy, stated plainly

Human pet roleplay is welcome: kitty, puppy, pony, hoods, tails,
collars, fetch, and other roleplay between consenting adults.
Bestiality — a real non-human animal as a sexual participant — is
banned. Explicit content lives behind login + the invite gate only.
No explicit imagery on public-facing pages.

## Working name and other options

- **Working name chosen for this build: Den & Desk** — it mirrors the
  two views in the plan (the Pet's Den, the Owner's Desk) without
  colliding with real-pet-owner apps.
- Other options considered: **Paws & Promises**, **The Quiet Den**.
- None of these reuses "Once Upon a Little" or collides with Offleash'd,
  Nuzalo, Petamur, or Hump (real-pet-owner apps). No domain has been
  registered and nothing has been paid for. The final name is still an
  open decision for GG Foxy.

## Repository layout

- `frontend/` — Vite + React + TypeScript SPA.
- `api/` — Express + TypeScript API. `api/src/db/schema.sql` is the
  PostgreSQL schema, and `api/src/db/postgres.ts` implements the same
  store interface against it. If `DATABASE_URL` is set, the API uses
  Postgres via `pg`; if it is not set, the API logs a warning and uses
  an in-memory store for local development only (data does not persist).
  Do not use the in-memory store for a shared deployment. Short-lived
  email codes are kept in memory in both modes, by design.
  The Postgres adapter is code-complete but was NOT integration-tested
  against a live database in Phase 0 (no Postgres server was available
  in the build environment and none was provisioned); test it once
  against a staging DATABASE_URL before a shared deployment.
- `.github/workflows/ci.yml` — lint, typecheck, tests, production build
  for both packages. Push only on green.

## Run locally

```bash
# API (port 4000 by default)
cd api && npm install && npm test && npm run build && npm start

# Frontend (port 5173 by default, proxies /api to localhost:4000)
cd frontend && npm install && npm test && npm run build && npm run dev
```

Environment for the API (copy to a local `.env`, never commit it):

```text
PORT=4000
JWT_SECRET=replace-with-a-long-random-secret
INVITE_CODES=DEN-WELCOME-2026
ALLOW_DEV_CODE=true   # development only; false in production
DATABASE_URL=          # leave empty for local in-memory store
```

## Hosting status — not deployed (blocker, not a failure of the build)

No live demo URL is claimed. No free-tier host was provisioned, because
provisioning Cloudflare Pages, Koyeb, Workers/D1, or Supabase needs an
account sign-in / personal data that this build did not supply, and no
paid plan, credit card, or phone verification was used (per the brief).
The order to try next, with a signed-in account, is:

1. Frontend: Cloudflare Pages (proven pattern from Once Upon a Little).
2. API: Koyeb free tier, then Cloudflare Workers + D1, then Supabase
   free tier.
3. Database: Neon free tier, or the database bundled with the chosen
   API host.

If any host asks for a credit card or a phone verification that fails
on a Wi-Fi number, stop that route and report it — do not work around
it. A real SMTP provider also has to be chosen, AND SMTP sending has
to be implemented in the `request-code` endpoint, before email-code
delivery works for real users; that is still a blocker after Phase 2.

## Publishing to GitHub — exact steps needed (not done)

The saved GitHub fine-grained token covers only the `haven` repo and
returns 403 on other repos (proven with nikki-control-panel). It was
not used here, and no token or secret is in this code or its history.

1. GG Foxy (or the main agent, in a browser while she is signed in to
   GitHub) creates a new **empty** public or private repo, e.g.
   `den-and-desk`, with no README / .gitignore / licence added by
   GitHub.
2. The local repo at `~/workspace/den-and-desk` is already committed
   (no remote yet). From there, add the new repo as remote and push
   from an account/token that has access to that repo. Do not use the
   saved haven-only token — it will 403 on this repo.
3. Connect Cloudflare Pages to that repo for the frontend, and the
   chosen API host to the same repo (or its `api/` directory).

## Proposed improvement cron (NOT created — for main-agent review)

- Daily ~04:47 America/Vancouver (different from the ABDL site's
  ~03:47), owned by the new project's goal once created.
- Each run: pull main, run frontend + API lint, typecheck, tests and
  production build, stop if red; implement exactly one small roadmap
  slice; re-verify green; push to main only on green; log to the daily
  note; report only when something changed or blocked.
- Plus a daily demo health check (HTTP 200 + brand text, silent
  unless down).
- Hard rules: never weaken auth/safety, never commit secrets, never
  push on red, never add a paid dependency for core features, never
  build beyond the approved roadmap without the owner's yes (ideas stay
  proposals).

## Open decisions (still GG Foxy's, not decided by this build)

1. Final name: Den & Desk vs Paws & Promises vs The Quiet Den (or new).
2. Premium extras: which, if any (supporter badge, merch) — core stays free.
3. Moderation staffing at launch: who staffs the urgent report queue.
   The queue mechanism exists in Phase 1 (`MODERATOR_EMAILS`), but
   the people are not chosen.
4. Age-assurance budget: stay declaration + invite gate longer, or pay
   for facial estimation (Didit free tier first) / ID checks for flagged
   accounts.
5. Events directory timing: build early, or link out to existing
   pup/handler/pony groups at first.
6. Email delivery provider for real email codes (still the Phase 1
   blocker for real signups).
7. API host + database choice from the free-tier order above, plus a
   staging Postgres test of the Phase 1 adapter.
8. Who gets the first invite codes, and how long the beta gate stays on.
9. GitHub remote creation (see "Publishing to GitHub" — not done,
   needs a signed-in GitHub account, not the haven-only token).

## Test/dev demo mode (2026-10-26, frontend only)

The Pages frontend has a clearly labelled test/dev demo, OFF by
default, so the site can be tried without a live API, database, or
email. Turn it on from the dashed "Test/dev demo — try it without a
live service" card on the landing page, then use invite code `TEST`
and demo code `123456`. Demo data stays in the browser only, is
clearly marked as demo, and can be reset with one button. Demo mode
is testing only — it is not a real account, and real mode stays
invite-only with the 18+ declaration gate. Cloudflare Pages GitHub
App access (2026-10-26): selected repositories are ggirlfoxi/haven
and ggirlfoxi/den-and-desk only, not all repositories.

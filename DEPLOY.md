# Den & Desk — deployment readiness (test/dev only)

> **TEST/DEV ONLY — READ FIRST.** This build is for testing and
> developing only. It is NOT a production launch, NOT for real users,
> and NOT an open beta. Invite-only gating stays on, no invites are
> sent from this build, and nothing here is presented as live for the
> public. A production launch is a separate future decision by the
> user, and is not made by this document or this build.

> **FREE ONLY — PAYMENT GATE.** No payment, paid plan, paid provider,
> paid dependency, card, subscription, or trial that converts to paid
> is used at any point in this build. Even after a finished, working,
> polished product exists, payment is a separate future user decision
> — never automatic, never assumed. At any step below, if a host,
> database, email, or other provider asks for payment, a card, a paid
> plan, or a converting trial: **STOP. Do not proceed, do not work
> around it, and report it as blocked for the user.**

## What is already built (local, test/dev)

- Phases 0–3: invite-only email-code auth, 18+ declaration gate,
  pseudonymous profiles, discovery, mailbox messaging, mutual trust
  badges, moderator safety queue, contracts with mutual signing and
  safeword pause/end, duties, bookings, aftercare, video-hello
  requests, scheduled check-ins, routine, owner commands, gear
  wishlist (no purchases), praise, and safe lost-pet mode (game
  board only — no real GPS, no stranger retrieval, no cash bounty).
- This slice: real Phase 3 + pet-sitting Postgres tables and adapter
  code, dependency-free SMTP sending code (env-driven, no provider
  chosen or paid for), and pet-sitting (temporary, bounded sits with
  dual agreement, instant reclaim / pet pause-end, auto-expiry,
  handover report, and a sitter badge only after a clean completed
  sit).
- Safety rules that never change: invite-only, 18+ adults only, no
  Facebook login, no contact sync, no real GPS, no cash bounty, no
  stranger retrieval or transport, no home address or keys in the
  app, safeword / pause / end always override everything.

## What a live test service still needs, in order

Work through these in order. Stop at the first step that demands
payment (see the payment gate above) and report it as blocked.

1. **API host sign-in (free tier only, user step).** Try, in order:
   Koyeb free tier, Cloudflare Workers + D1, or Supabase free tier.
   STOP if any route demands a card, a phone verification that fails
   on the user's number, a paid plan, or a converting trial. That
   step is the user's, not the build's — no host account is created
   by this code.
2. **Postgres provisioning (free tier only).** Provision a free test
   database and set `DATABASE_URL`. Then run the API once against it
   and exercise Phase 3 and sitting endpoints end-to-end. This is
   still required because the Postgres adapter was verified in this
   build only against a mock Pool (SQL strings + row mapping) plus
   schema review — no Postgres server was available in the build
   environment, so this is NOT a live Postgres test. STOP on any
   payment demand.
3. **SMTP provider + env vars (free tier only, user step).** Choose a
   free-tier SMTP route (no provider is recommended or paid for
   here), then set only these env vars on the host:
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
   Without them, login-code requests fail loudly with 503 and no
   code is stored, sent, or logged — that is intentional, not a bug.
   The local dev code path (`ALLOW_DEV_CODE=true`) is test/dev only,
   off by default, and refused in production. STOP on any payment
   demand.
4. **`MODERATOR_EMAILS`.** Set the comma-separated moderator email
   list. Until it is set, nobody can view the safety queue (reports
   are still stored, urgent ones flagged).
5. **`INVITE_CODES`.** Set the real invite codes for the test group.
   Do NOT send invites to real users from this build — invite-only
   test/dev only, and any wider invite step is a separate user
   decision.
6. **Age-assurance budget decision (user decision, still open).**
   The gate today is an 18+ declaration only. A real age-assurance
   provider, and any budget for it, is still undecided — and under
   the payment gate, no paid provider is assumed or chosen here.

## Env vars the live test service needs (values are the user's)

- `DATABASE_URL` — free test Postgres connection string.
- `JWT_SECRET` — a long random secret (never the dev default).
- `INVITE_CODES` — comma-separated test invite codes.
- `MODERATOR_EMAILS` — comma-separated moderator emails.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  — free-tier SMTP only; see step 3 and the payment gate.
- `PORT` — API port (default 4000 locally).
- `ALLOW_DEV_CODE` — leave unset (off) outside local test/dev.
  Never set it to `true` in production.

## What is still NOT done, even after the steps above

- No live Postgres test (mock only, as stated above).
- No real email send has been performed (SMTP code is tested only
  against a local fake SMTP server in unit tests).
- Den-door animation, lost-poster pulse, and in-app sounds were
  code-checked only, not verified on a real phone.
- Age assurance is declaration-only; a real provider is undecided.
- Production launch, open beta, and any payment are separate future
  user decisions — none are made, assumed, or started by this build.

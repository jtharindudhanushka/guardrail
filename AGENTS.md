<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Context for any agent (or human) picking up this repo cold. Read this before making
changes. Keep it updated whenever architecture, protocol, or conventions change —
this file is the source of truth, not a changelog.

## What this is

Guardrail is a consensual usage-limiting tool: one person (the **Controller**, the
account holder) sets per-site daily time budgets and a YouTube whitelist on a Windows
laptop (the **device**), and can grant temporary bypasses on request. There is no
second role, no covert monitoring, and no content/URL logging — only aggregate
elapsed-seconds-per-domain ever leaves the device. Do not add activity logs, history
views, or anything that resembles surveillance without an explicit request; this
was a deliberate scope decision, not an oversight.

## Repo layout

```
prisma/           schema.prisma (Postgres), no committed migrations (see below)
src/app/          pages, route handlers, server actions
src/lib/          prisma client, auth, agent auth, id generation
agent-src/        standalone Node.js agent - NOT part of the Next.js build,
                   deployed onto the Windows target machine by the installer
```

`agent-src/` is intentionally a separate, dependency-light CommonJS project (only
`node-forge` as a dependency). It is never imported by the Next app; it's served
file-by-file to the installer script via `GET /api/agent-files/[...file]` and run
standalone with plain `node agent.js` on the target machine.

## Next.js version notes (this is Next 16, not the Next you trained on)

- Middleware is renamed **Proxy**: the file is `src/proxy.ts`, exporting a function
  named `proxy` (not `middleware`). Don't recreate `middleware.ts`.
- Route params, `cookies()`, and `headers()` are all `Promise`-based — always
  `await params`, `await cookies()`, `await headers()`.
- Prisma Client (v7, generator `prisma-client`) is generated to
  `src/generated/prisma/`, but the class/types are exported from
  `src/generated/prisma/client.ts`, not an `index.ts`. Import from
  `@/generated/prisma/client`, not `@/generated/prisma`.
- Prisma Client requires an explicit **driver adapter** now — see `src/lib/prisma.ts`,
  which uses `@prisma/adapter-pg` against `DATABASE_URL`. There is no query-engine
  binary fallback configured; don't remove the adapter.
- `src/generated/prisma` is gitignored and regenerated via `prisma generate`, wired
  into `postinstall` and `build` in `package.json`. If Prisma types seem "missing"
  after a fresh clone, run `npm install` (postinstall covers it) before assuming
  something's broken.

## Data model (`prisma/schema.prisma`)

`User` → owns `Device`s. Each `Device` has `SiteRule`s (domain + daily minute
budget), `YoutubeRule`s (VIDEO/CHANNEL/PLAYLIST whitelist entries), `BypassCode`s
(time-boxed unlocks, `domain: null` = all social sites), and `UsageState` (aggregate
elapsed seconds per domain per local day — the only usage data ever stored).

No migrations are committed (the schema was built and iterated against SQLite during
development, then switched to Postgres for deployment — migration history from that
switch isn't meaningful). Use `npm run db:push` (`prisma db push`) against a real
`DATABASE_URL` to sync schema. If you introduce real migration history going forward,
switch to `prisma migrate dev` / `migrate deploy` and commit `prisma/migrations/`.

## Portal mutation pattern

Portal-side mutations (create device, add/remove site rules, add/remove YouTube
rules, issue/revoke bypass) are all **Next.js Server Actions** in
`src/app/dashboard/actions.ts` and `src/app/(auth)/actions.ts` — not REST routes.
Keep it that way; there's no reason to expose a public API surface for actions only
the logged-in Controller triggers from the portal UI itself.

The **only** real REST API routes are the agent-facing ones under `src/app/api/agent/`
and `src/app/api/agent-files/`, `src/app/api/install/` — these are called by an
external process (the Windows agent, or `Invoke-WebRequest`/`curl`), so they have to
be actual HTTP endpoints authenticated by API key, not server actions.

## Agent protocol

1. `POST /api/agent/pair` `{ code }` → `{ deviceId, apiKey, deviceName }`. Pairing
   code is single-use — consumed (set to `null`) on success.
2. `GET /api/agent/rules` with `Authorization: Bearer <apiKey>` → current site
   rules, YouTube whitelist, and active bypasses. Also updates `lastSeenAt`
   (this call *is* the heartbeat — there's no separate heartbeat endpoint).
3. `POST /api/agent/usage` with the same bearer auth → upserts aggregate
   `{ domain, dateKey, elapsedSeconds }` entries. Never send URLs, video titles, or
   anything content-identifying here — enforce that in review.

"Online" in the dashboard is computed purely from `lastSeenAt` age
(`ONLINE_WINDOW_MS`, currently 45s vs. a 15s agent poll interval). It is never set
directly — don't add a way to mark a device online without a real poll hitting
`/api/agent/rules`.

## Agent enforcement design (and its honest limitations)

- **Site blocking**: hosts-file redirect to `127.0.0.1` for domains over budget
  (`agent-src/lib/hosts.js`), scoped by marker comments so it never touches the rest
  of the file.
- **Time budget tracking is wall-clock-while-unblocked**, not real active-tab
  detection — there's no browser extension or packet inspection telling the agent
  whether the user is actually looking at the tab. Every poll tick that a site is
  under budget, its counter advances. This is a deliberate MVP tradeoff (no browser
  extension needed), not a bug — flag it if a request implies precise "active usage"
  tracking is expected.
- **YouTube whitelist** is enforced via a local TLS-intercepting reverse proxy
  (`agent-src/lib/interceptServer.js`) bound to `127.0.0.1:443`/`:80`, using a
  self-signed local CA (`agent-src/lib/certs.js`, real node-forge CA + signed leaf
  certs — chain-verified in testing) that the installer trusts via `certutil`.
  - VIDEO/PLAYLIST rules match directly against the request URL.
  - CHANNEL rules resolve via YouTube's free, keyless **oEmbed** endpoint
    (`agent-src/lib/youtubeRules.js`) to get `author_url`, then substring-match. This
    is an approximation, not an authoritative channel-ID lookup — good enough
    without needing an API key, but don't present it as exact.
  - Both full-page loads (`/watch`, `/shorts/*`, `/embed/*`) and the `youtubei/v1/player`
    SPA API call are gated, since YouTube's client-side navigation often skips a
    fresh page load. Some deep-SPA edge cases may still slip through; a full page
    reload always re-triggers the gate.
- Real (non-YouTube, non-blocked) HTTPS traffic is *not* decrypted — the intercept
  server only terminates TLS for hostnames it's actually redirecting via hosts file
  (blocked social domains + the fixed YouTube host list). Keep it that way; don't
  widen the intercepted host set without a reason, for her privacy's sake as much as
  anyone's.
- **Browser "Secure DNS" (DNS-over-HTTPS) bypasses the hosts file entirely** — if a
  browser resolves domains itself via encrypted DNS to a public resolver instead of
  asking the OS, it skips the hosts file redirect completely and defeats both the
  site-blocking and the YouTube intercept. `install.ps1` (`src/app/api/install/route.ts`)
  mitigates this by adding a Windows Firewall rule (`Guardrail-Block-DoH`) blocking
  outbound 443/853 to the major public DoH/DoT resolver IPs (Cloudflare, Google,
  Quad9, OpenDNS, CleanBrowsing, AdGuard), which forces "Automatic" Secure DNS mode
  to fall back to the OS resolver. This is an IP-list allowlist-style hack, not a
  complete solution — a browser pinned to a DoH provider outside that list, or a new
  provider added later, will still bypass enforcement. `uninstall.ps1` removes the
  same firewall rule by display name. If this list needs extending, keep it in sync
  in both routes.

## Design system

Apple-style tokens live as CSS custom properties + a Tailwind v4 `@theme inline`
block in `src/app/globals.css`, plus prebuilt utility classes: `.btn-primary`,
`.btn-secondary-pill`, `.btn-dark-utility`, `.card-utility`, `.input-pill`,
`.text-link` / `.text-link-on-dark`. Reuse these rather than inventing new button/card
styles — the whole point of the token system is one consistent look. Font is Inter
(loaded via `next/font/google`) standing in for SF Pro per the design spec's documented
substitution guidance.

## Conventions to maintain going forward

- Keep this file and `README.md` in sync with reality on every structural change —
  new routes, new agent capabilities, schema changes, deployment changes.
- No content/URL/history logging, anywhere, ever — this is a hard constraint from
  the project's original scope decision, not just a current implementation detail.
- The Controller is the only writer of rules. If a second role (e.g. the device
  user requesting an unlock through the portal) is ever added, it must be
  strictly request-only, never able to self-approve.

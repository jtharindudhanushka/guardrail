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
- **Fail-open is a hard invariant.** A hosts entry pointing at `127.0.0.1` while
  nothing is listening there produces `ERR_CONNECTION_REFUSED` on every request —
  the site appears completely dead rather than showing a block page, and it stays
  that way after the agent dies. Two rules follow, both already implemented; don't
  regress them:
  1. `interceptServer.start()` returns a promise that resolves *only* once both
     listeners are actually bound. Never write hosts entries before it resolves; if
     it rejects (port 443 in use, no admin rights), release all blocks and exit.
  2. `agent.js` installs cleanup handlers (`SIGINT`/`SIGTERM`/`SIGHUP`/`exit`/
     `uncaughtException`) that call `applyBlockedDomains([])`. The installer also
     clears any stale marked block at the start of a fresh install, since a
     hard-killed agent can't run its own handlers.
  3. Cleanup is gated on an `ownsBlocks` flag, set only after this process
     successfully binds and writes its own entries. A second instance that loses the
     race for port 443 must exit *without* touching the hosts file — otherwise it
     would wipe the healthy instance's blocks on its way out.
- **Time budget tracking is wall-clock-while-unblocked**, not real active-tab
  detection — there's no browser extension or packet inspection telling the agent
  whether the user is actually looking at the tab. Every poll tick that a site is
  under budget, its counter advances. This is a deliberate MVP tradeoff (no browser
  extension needed), not a bug — flag it if a request implies precise "active usage"
  tracking is expected.
- **Whitelist beats budget, for playback only.** YouTube is always whitelist-gated
  (the agent permanently routes YouTube hosts through the intercept server), so a
  `youtube.com` SiteRule is optional. When both exist, the resolved semantics are:
  an explicitly approved video/channel/playlist plays *even after* the youtube.com
  budget is exhausted, while general browsing (home, search, channel pages) is
  blocked once the budget runs out. `requestHandler` therefore routes YouTube hosts
  to `handleYoutubeSite` **before** the generic `isBlockedSocialHost` check — don't
  reorder those, or approved videos start showing the "Time's up" page (this was a
  real reported bug).
  Block pages are additionally gated on `isDocumentRequest`: returning HTML for a
  script/fetch sub-resource breaks the page instead of blocking it, which would
  break playback of approved videos whose assets live on youtube.com paths.
  `agent-src/test/routing.test.js` locks all of this in — run `npm test` in
  `agent-src/` after touching routing.
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

## Request-handling must never crash the process

A single failed proxied request used to kill the entire agent: an upstream that errors
*after* the response has started streaming makes `writeHead` throw
`ERR_HTTP_HEADERS_SENT`, which reached `uncaughtException` and exited — releasing all
blocks and leaving the machine unenforced until the next reboot. Observed in the wild
after a brief DNS failure.

Rules, all covered by `test/resilience.test.js`:
- Every failure path goes through `failResponse()`, which checks
  `headersSent`/`writableEnded` and additionally wraps `writeHead` in try/catch. The
  try/catch is the load-bearing part — the flag check alone isn't sufficient, since a
  response can end between the check and the write.
- `ignoreStreamErrors()` attaches no-op error handlers to req/res/upstream streams.
  Client aborts are routine, not exceptional. It also guards `typeof s.on` — a
  crash-prevention helper must not be able to crash.
- `lib/resolve` is imported as a namespace (`dns`), not destructured, so tests can
  substitute `resolveReal`. A destructured binding captures the original forever and
  silently makes DNS stubs no-ops — which previously left `routing.test.js` passing
  only because real DNS happened to fail in the sandbox.

The scheduled task also carries a 5-minute repetition trigger as a watchdog, so a
crashed agent recovers on its own. Duplicate launches are harmless: the second
instance fails to bind port 443 and exits without touching the hosts file.

## Updating an installed agent

Re-running the install command **without** `?code=` upgrades an existing install in
place: `install.ps1` reads the current `config.json` and, if it already has an
`apiKey`, preserves the device identity instead of overwriting it. A pairing code is
only needed to enrol a brand-new device; with no existing install and no code, the
script throws a clear message rather than half-installing.

`config.json` lives in `%ProgramData%\Guardrail\` while code lives in `app/` beneath
it, so agent files can be replaced freely without disturbing identity or rules.

The installer must stop the running agent **before** downloading files, and the
process match has to be on `agent.js` in the command line — the agent runs as
`node.exe agent.js`, so matching on "Guardrail" finds nothing, leaves the old process
holding port 443, and the freshly started one exits immediately without enforcing.

There is deliberately no automatic self-update: it would need staged downloads,
per-file validation, and a rollback path, because a failed update leaves a machine
with hosts blocks applied and no agent to clear them. Revisit only if manual updates
become frequent enough to justify carrying that.

## Remote uninstall on device deletion

Deleting a device in the portal is also the remote-uninstall trigger. API keys are
issued once at pairing and never rotated, so a `401` from `/api/agent/rules` means
the device row is gone. After `UNKNOWN_DEVICE_THRESHOLD` (4) *consecutive* 401s —
roughly a minute, so a transient network or edge failure can't trigger it — the agent
runs `lib/selfUninstall.js`, which clears hosts entries in-process and then spawns a
detached PowerShell that removes the scheduled task, the DoH firewall rule, the
trusted CA, any leftover hosts block, and finally the whole data directory.

Two things that will silently break this if changed:
- The cleanup process **must not inherit the agent's cwd** (it sits inside the
  directory being deleted; holding it open makes the removal fail). It's pinned to
  `%SystemRoot%`.
- The streak counter must reset on any non-401 error and on success. Never
  self-uninstall on a single failure.

`ownsBlocks` is cleared before calling `selfUninstall` so the normal exit handler
doesn't race the cleanup script over the hosts file.

## Windows scheduled task gotchas

The agent runs via a `GuardrailAgent` scheduled task (SYSTEM, highest privileges,
`-AtStartup`). Things that silently break it — all worked around in
`src/app/api/install/route.ts`, keep them:

- **Battery power.** Task Scheduler's default settings refuse to start a task on
  battery and report *no error* (`LastTaskResult` stays `0`), which looks exactly
  like the task never existing. `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`
  is mandatory on a laptop.
- **`.cmd`/`.bat` cannot be an `-Execute` target.** `CreateProcess` can't run a batch
  file directly, so pointing `-Execute` at `run-agent.cmd` leaves the task stuck in
  state `Queued` forever — `LastTaskResult` stays `0`, `LastRunTime` updates, and no
  process is ever spawned (confirmed on a real device). The action must be
  `cmd.exe /c "<path to .cmd>"`. If you ever see `Queued` with no `agent-stdout.log`,
  this is the cause.
- **Paths with spaces.** `-Execute` pointed at `C:\Program Files\nodejs\node.exe`
  can fail to launch. The task runs a generated `run-agent.cmd` wrapper instead,
  which also redirects stdout/stderr to `agent-stdout.log` so a failed launch leaves
  evidence rather than nothing.
- **Don't rely on the task for the first run.** The installer starts the agent
  directly with `Start-Process` and verifies pairing from that, so a working install
  never depends on trigger behaviour; the task only covers restarts after boot.
- **Bare `node.exe` on PATH.** Right after winget installs Node, the Task Scheduler
  service may not see the updated PATH. Always resolve and embed the full path.
- `-ExecutionTimeLimit ([TimeSpan]::Zero)` — otherwise the task is killed after the
  default 3 days.
- **Repetition duration must be finite.** `[TimeSpan]::MaxValue` produces a perfectly
  valid trigger *object*, so it passes any check that only calls
  `New-ScheduledTaskTrigger` — but `Register-ScheduledTask` then rejects the XML with
  "value which is incorrectly formatted or out of range". Use a long finite span
  (currently 3650 days). Validating trigger construction is not validating
  registration; only an actual `Register-ScheduledTask` call proves it works.
- Registration is wrapped in try/catch that falls back to boot-trigger-only, then to
  no task at all. Starting the agent matters more than the task, and an install must
  never abort before `Start-Process` over a trigger problem.

Two log files exist on the device: `agent.log` (written by the agent itself) and
`agent-stdout.log` (raw stdout/stderr from the wrapper — the place to look when the
agent appears to not start at all).

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

# Guardrail

A self-hosted portal + Windows agent for setting daily time budgets on specific
sites and whitelisting specific YouTube videos, channels, or playlists — with a
gatekeeper who can grant temporary bypasses on request.

Built for consensual personal use (e.g. a couple agreeing on shared usage limits),
not covert monitoring: the agent reports only aggregate time-per-site back to the
portal, never URLs, page titles, or browsing history.

## How it works

```
┌─────────────┐        HTTPS         ┌──────────────────┐
│   Portal     │ ◄──────────────────► │  Windows Agent    │
│ (Next.js,    │   poll every 15s:    │  (Node.js,         │
│  Vercel)     │   rules + bypasses    │  runs as a         │
│              │   report: usage       │  scheduled task)   │
└──────┬───────┘                       └─────────┬─────────┘
       │                                          │
       │ Postgres                                 │ hosts file redirect
       ▼                                          │ + local TLS proxy for
┌─────────────┐                                   │ YouTube video/channel/
│   Database   │                                   │ playlist filtering
└─────────────┘                                    ▼
                                          Instagram, TikTok, etc. blocked
                                          past budget · only whitelisted
                                          YouTube content plays
```

The Controller (portal account holder) sets rules in the browser. The agent on
the target laptop polls for those rules, enforces them locally, and reports back
only how many seconds-per-day each site was used — nothing else.

## Features

- **Per-site daily time budgets**, editable anytime, reset at local midnight
- **YouTube whitelist** — allow specific videos, whole channels, or whole
  playlists; everything else on YouTube is blocked
- **Temporary bypass codes** — grant extra time on a site (or all of them) for a
  set number of minutes, revocable early
- **One-line install** on the target Windows laptop — no manual setup beyond
  running a single PowerShell command with a pairing code
- **No content logging** — only aggregate elapsed-seconds-per-domain is ever
  stored or transmitted

## Tech stack

- **Portal**: Next.js 16 (App Router, Server Actions), Tailwind v4, Prisma 7 +
  Postgres, `jose` for signed session cookies, `bcryptjs` for password hashing
- **Agent**: plain Node.js (CommonJS, one dependency — `node-forge` for local CA
  and cert generation), no browser extension required
- **Design**: an Apple-style design system (tokens in `src/app/globals.css`) —
  quiet blue accent, pill buttons, parchment/white/near-black tile rhythm

## Local development

```bash
git clone https://github.com/jtharindudhanushka/guardrail-.git
cd guardrail-
npm install
cp .env.example .env   # fill in DATABASE_URL (Postgres) and AUTH_SECRET
npm run db:push        # sync the schema to your database
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up — you become the
Controller for your own account.

## Deployment (Vercel + Neon)

1. Create a free Postgres database at [neon.tech](https://neon.tech) (or Supabase,
   or any Postgres host) and copy its connection string.
2. Import this repo into [Vercel](https://vercel.com/new).
3. In the Vercel project's Environment Variables, set:
   - `DATABASE_URL` — the Postgres connection string from step 1
   - `AUTH_SECRET` — a long random string (`openssl rand -hex 32`)
4. Deploy. Vercel runs `prisma generate && next build` automatically (see
   `package.json`).
5. Once deployed, run `npx prisma db push` once against the production
   `DATABASE_URL` (locally, with `.env` pointed at production, or via a one-off
   Vercel deployment hook) to create the tables.

## Installing the agent on a Windows laptop

1. Sign in to the deployed portal, add a device, and copy its pairing command
   from the device page — it looks like:
   ```powershell
   irm "https://your-deployment.vercel.app/api/install?code=XXXXXXXX" | iex
   ```
2. Run that command in an **administrator** PowerShell window on the target
   laptop. It downloads the agent, installs Node.js if missing, trusts a local
   certificate (needed to filter specific YouTube videos), and registers a
   scheduled task so the agent starts automatically on every boot.
3. Back in the portal, the device flips to "Online" within about 15–20 seconds.

See [`AGENTS.md`](./AGENTS.md) for architecture details, the agent protocol, and
known limitations if you're extending this project.

## Status

Personal project, actively maintained. Not audited for anything beyond its
intended consensual, single-Controller use case.

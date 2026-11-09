# Deploying Gaffer on Cloudflare

You need a free Cloudflare account and Node 20 or newer. I can't do the account steps for you (logging in, adding a domain), so this is exactly what to run.

## 1. First deploy (about two minutes)

```bash
npm install
npx wrangler login        # opens a browser, you click Allow
npm run deploy            # builds the client, then publishes the Worker
```

Wrangler prints a URL like `https://gaffer.<your-account>.workers.dev`. Open it on your phone and your friend's phone. That's it.

What got created: one Worker (the site, the API and the sockets) and one Durable Object class, `Room`, with SQLite storage. Each room code is its own object, created on demand.

> **Never rename the `Room` class** in `wrangler.jsonc` / `src/server/room-do.ts` without adding a migration. Renaming it silently orphans every live room.

## 2. Check it really works

1. `curl https://<your-url>/api/health` returns `{"ok":true,...}`.
2. Create a room on your laptop, open the link on your phone, and play a draft.
3. **Mid-draft, lock your phone screen for 30 seconds and unlock it.** You should come back to the same game. This is the one thing I could not test on a real device.
4. Close the phone's browser tab and reopen the link: you should land back in your seat.

## 3. Your own domain (optional)

Your domain's DNS must be on Cloudflare. Add this to `wrangler.jsonc` and redeploy:

```jsonc
"routes": [{ "pattern": "play.yourdomain.com", "custom_domain": true }]
```

Or in the dashboard: Workers & Pages, your Worker, Settings, Domains & Routes, Add, Custom domain.

## 4. Deploy automatically from GitHub (optional)

Merge the branch into `main` first. Then in the dashboard: Workers & Pages, Create, Import a repository. Build command `npm run build`, deploy command `npx wrangler deploy`. Every push to `main` deploys.

## 5. Before you share the link widely

Room codes are four letters, so someone could stumble into an *empty lobby*. Seats are protected by a secret and a started game refuses strangers, but if you post the URL publicly, add two Cloudflare rate-limiting rules (Security, WAF, Rate limiting rules):

| rule | match | suggestion |
|---|---|---|
| room creation | `POST /api/rooms` | 20 requests per minute per IP |
| sockets | `/ws/*` | 60 requests per minute per IP |

Also see "A note on the players" in the README before promoting it.

## 6. Cost (Likely, check the live pricing page)

Workers and SQLite-backed Durable Objects have a free tier. A two-player game is roughly 150 WebSocket messages, and idle rooms hibernate, so a few friends playing every day should sit comfortably inside it. If you grow, the paid plan is a flat monthly fee plus usage.

## 7. Operating it

```bash
npx wrangler tail            # live logs
npx wrangler rollback        # back to the previous version
```

- Rooms expire by themselves: 45 minutes after everyone leaves, 12 hours at most.
- A deploy drops open sockets for a moment; players reconnect on their own and their state is kept.
- **Don't delete a player id from `src/shared/players.ts` while rooms are live.** A room remembers picks by id; a missing id would break that room's screens (the page shows a friendly "Reload" panel, and the room still finishes). Add players freely; remove after rooms have expired.
- Rooms never touch a database you manage, and there is nothing to back up.
- A room saved by an older build of the game cannot be resumed (the stored format changed with tournaments), so it is dropped on deploy. Rooms last an evening, so this only matters for a game that is mid-draft at the moment you deploy.
- **Name clashes with your other Cloudflare projects.** Two things can collide: the Worker name (`gaffer` in `wrangler.jsonc`) and a custom domain or route. A different Worker with a different name and no shared route cannot interfere. If another project already uses the name `gaffer`, or the hostname or route you attach, change `name` in `wrangler.jsonc` (and never reuse a Durable Object class name across Workers you want to keep separate) before deploying. Check **Workers & Pages** in the dashboard first; nothing here deletes or touches another project.

## Prefer your own server?

```bash
npm run build
PORT=8080 npx tsx src/server/node-dev.ts     # serves the site and the sockets
```

Put it behind HTTPS (for example Caddy). Rooms live in memory, so a restart ends games in progress. Cloudflare is the better home; this is the escape hatch.

## Vercel instead?

You can host the static site there, but the multiplayer needs a WebSocket host and Vercel's functions can't be one. You would run the Node host somewhere else, or pay for a realtime service, and point the client at it. That is more moving parts for no gain, which is why this project targets Cloudflare.

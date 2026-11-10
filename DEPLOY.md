# Deploying Gaffer on Cloudflare

You need a free Cloudflare account. On a laptop you also need Node 20 or newer; on a phone, skip to section 0. I can't do the account steps for you (logging in, adding a domain), so this is exactly what to do.

## 0. From an iPhone, no laptop (about ten minutes)

You do not need Node, npm or the terminal. Cloudflare can build the game straight from your GitHub repository. Do this in Safari on the phone. Cloudflare's dashboard is cramped on a phone, so tap **aA** in the address bar and choose **Request Desktop Website** first.

1. Sign up or log in (free) at **dash.cloudflare.com**.
2. Go to **Workers & Pages**, tap **Create**, then **Import a repository** (labelled "Connect to Git" in some versions). Sign in to GitHub when asked and install the Cloudflare GitHub app. Give it access to **only the repository this project lives in**.
3. Pick the repository. Keep the project name **`gaffer`**. It has to match `name` in `wrangler.jsonc`, or the build fails.
4. Under branch settings, set the **production branch** to `claude/dazzling-brown-bgiy1o` (that is where the finished game is). Once you have merged it into `main`, switch this to `main`.
5. **Build command:** `npm run build`. **Deploy command:** `npx wrangler deploy` (that is the default).
6. Tap **Save and Deploy**. The first build takes a minute or two. When it is green, open the Worker. The address is `https://gaffer.<your-name>.workers.dev`.
7. Open that address on your phone, tap **Create a room**, and send the link to your friend. Add it to your home screen from Safari's share sheet if you like.

From then on, every push to the production branch deploys by itself. If a build fails, open the build log in the dashboard and send me the last 20 lines.

The free plan is enough: Durable Objects are available on it when they use SQLite storage, which is what this game uses. (Free plan limits are 100,000 requests and 13,000 GB-seconds of Durable Object time a day, far more than an evening of drafting.)

Menu names in Cloudflare's dashboard change now and then. If a label differs, look for the same idea: connect a Git repository, set the production branch, set the build command.

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

## 8. Career mode: accounts, leagues and Google sign-in

**Nothing is required.** Career mode works the moment this deploys: guests sign in with just a name, and the new storage (one Durable Object per league, one per account) is created by the `v2` migration in `wrangler.jsonc` on the first deploy. There is no database to create and no secret to set; the server makes and keeps its own signing secret.

**Optional: "Continue with Google"** (so a league follows you across phones and survives clearing your browser). You can do all of this on an iPhone:

1. Open `console.cloud.google.com` in Safari, create a project (any name).
2. *APIs & Services → OAuth consent screen*: choose *External*, give it an app name and your email, save. While the app is in *Testing*, only the Google accounts you add under *Test users* can sign in. Press *Publish app* when you want anybody to be able to.
3. *APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.* Under *Authorized JavaScript origins* add your site exactly as it appears in the address bar, for example `https://gaffer.yourname.workers.dev` (and your own domain if you add one). Leave *redirect URIs* empty. Create it and copy the **Client ID**. You do not need the client secret and should not paste it anywhere.
4. In your GitHub repository open `wrangler.jsonc`, put the Client ID in `"vars": { "GOOGLE_CLIENT_ID": "…" }` and commit. Cloudflare redeploys by itself. (Set it in `wrangler.jsonc`, not only in the Cloudflare dashboard: a deploy from Git makes the file the source of truth and would overwrite a dashboard-only value.)
5. Open `/career`. The Google button appears above the guest option. If it does not, `GET /api/me` returns `"googleClientId": null`, which means the variable did not reach the deploy.

What is safe, and what is not:

* **(Certain)** We never see a Google password. The browser sends us a signed Google ID token; the server checks its signature against Google's public keys, the issuer, that it was minted for *your* client id, that it has not expired, and a one-time-looking value only this server could have issued (so a copied token cannot be replayed). Tests cover the classic attacks (unsigned `alg: none` tokens, the wrong audience, an old token).
* **(Certain)** We keep a one-way hash of your Google user id, a name you can change, and the list of leagues you are in. No email address, no photo. Other players only ever see your display name.
* **(Certain)** The sign-in cookie is `HttpOnly` (scripts cannot read it), `SameSite=Lax`, and `Secure` on https. Anything that changes data also checks the request came from this site.
* **(Likely)** A guest account is exactly as private, but it lives only in that browser's cookie. Clear it and the leagues are unreachable. Use Google for a league you care about.
* **(Guessing)** I could not test the Google button itself here (no Google account, no network). Everything around it is tested; the first real sign-in is the first end-to-end check, so try it once before you rely on it.

Leagues nobody has opened for 120 days are deleted automatically.

## Prefer your own server?

```bash
npm run build
PORT=8080 npx tsx src/server/node-dev.ts     # serves the site and the sockets
```

Put it behind HTTPS (for example Caddy). Rooms live in memory, so a restart ends games in progress. Cloudflare is the better home; this is the escape hatch.

## Vercel instead?

You can host the static site there, but the multiplayer needs a WebSocket host and Vercel's functions can't be one. You would run the Node host somewhere else, or pay for a realtime service, and point the client at it. That is more moving parts for no gain, which is why this project targets Cloudflare.

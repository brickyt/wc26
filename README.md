# North End — World Cup 2026 Scoreboard

Two pages, one Cloudflare Pages site:

- **/**        → live scoreboard (pulls real scores from ESPN via a cached function)
- **/demo/**   → the mockup (sample data, never touches the network)

Only one line differs between the two HTML files: `const DEMO = …` near the top of the
`<script>`. `false` = live, `true` = demo.

```
public/
  index.html        # live page  (DEMO = false)
  demo/index.html   # demo page  (DEMO = true)
  _routes.json      # only /api/* invokes the function; everything else is free static
functions/
  api/
    scores.js       # ESPN poller + mapper  ->  served at /api/scores
README.md
HANDOFF.md
```

## How the live data works
The page fetches `/api/scores`. That Cloudflare Pages Function makes ONE call to ESPN's
unofficial scoreboard for the whole tournament, maps each match to our shape, and returns
JSON. The response is stored at the edge via the Cache API (`caches.default`) so every
visitor hitting the same Cloudflare colo shares a single ESPN call. The cache TTL is
adaptive: 60s while matches are live or near kickoff, otherwise it sleeps until the next
kickoff (cap 30 min), and 1 hour once the tournament is over.

Teams are joined to our rosters by FIFA code first (e.g. MEX, KOR), then by name, then by
an id override. Any team the function can't map is listed under `unresolved` in the JSON —
check that during the pre-tournament test (see below). (Note: `unresolved` legitimately
contains the TBD knockout bracket placeholders like "Group A Winner" / "Round of 32 1
Winner"; what matters is that no real *country* appears there.)

## Deploy (Cloudflare Pages, ~5 min)
Connect this repo to a Cloudflare Pages project so every push auto-deploys with the
function attached.

1. Push this folder to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank — static site)*
   - **Build output directory:** `public`
   - Functions are auto-detected from the root `functions/` directory; no config file needed.
4. Deploy. Your site is at `https://<project>.pages.dev` (add a custom domain under
   **Custom domains** if you want).

There's no build step or config file — routing is file-based (`functions/api/scores.js`
→ `/api/scores`), and `public/_routes.json` keeps all static requests off the function so
they stay on the free static tier.

## Smoke tests (do these before June 11)
1. **Function returns data:** open `https://<site>/api/scores` —
   you should see JSON with `matches` full of the real fixtures (all `status:"pre"`) and an
   `unresolved` array containing only TBD bracket placeholders (no real countries). If a real
   country shows up in `unresolved`, add it to `NAME_ALIASES` or `ID_OVERRIDE` in
   `functions/api/scores.js`.
2. **Page renders live:** open `/` — Upcoming should fill with the real 48-team schedule,
   the feed pill should read "Live · ESPN", Live/Completed empty, standings all 0.
3. **Live/final branch (optional):** temporarily change the league in `functions/api/scores.js`
   to one in season (e.g. `usa.1` MLS) to watch a real in-progress match map to `live`/`final`,
   then switch back to `fifa.world`.
4. **Demo still isolated:** `/demo/` should show the sample QF-day data and the gold
   "Demo · sample data" pill, with no network calls.

When the tournament starts, no changes are needed — the function flips matches to live/final
on its own and the cadence tightens automatically.

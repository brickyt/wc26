# North End — World Cup 2026 Scoreboard

Two pages, one Netlify site:

- **/**        → live scoreboard (pulls real scores from ESPN via a cached function)
- **/demo/**   → the mockup (sample data, never touches the network)

Only one line differs between the two HTML files: `const DEMO = …` near the top of the
`<script>`. `false` = live, `true` = demo.

```
public/
  index.html        # live page  (DEMO = false)
  demo/index.html   # demo page  (DEMO = true)
netlify/
  functions/
    scores.mjs      # ESPN poller + mapper (server-side)
netlify.toml        # publish=public, functions dir, /api/scores alias
```

## How the live data works
The page fetches `/.netlify/functions/scores`. That function makes ONE call to ESPN's
unofficial scoreboard for the whole tournament, maps each match to our shape, and returns
JSON. The response is CDN-cached (`s-maxage`) so every visitor shares a single ESPN call:
60s while matches are live or near kickoff, otherwise it sleeps until the next kickoff
(cap 30 min), and 1 hour once the tournament is over.

Teams are joined to our rosters by FIFA code first (e.g. MEX, KOR), then by name, then by
an id override. Any team the function can't map is listed under `unresolved` in the JSON —
check that during the pre-tournament test (see below).

## Deploy (desktop, ~5 min)
Easiest is to connect this folder as a GitHub repo so every push auto-deploys with the
function attached (drag-and-drop deploys don't include functions reliably).

1. Create a new GitHub repo and push this folder, **or** use the Netlify CLI:
   ```
   npm i -g netlify-cli
   netlify deploy --prod
   ```
2. In Netlify: connect the repo (or run the CLI). Build command: none. Publish dir: `public`.
   Functions dir: `netlify/functions` (already set in netlify.toml).
3. Point your existing site `northendwc26` at this repo (Site settings → Build & deploy),
   or deploy fresh and update the domain.

## Smoke tests (do these before June 11)
1. **Function returns data:** open `https://<site>/.netlify/functions/scores` —
   you should see JSON with `matches` full of the real fixtures (all `status:"pre"`)
   and an empty `unresolved` array. If `unresolved` is non-empty, add those teams to
   `NAME_ALIASES` or `ID_OVERRIDE` in `scores.mjs`.
2. **Page renders live:** open `/` — Upcoming should fill with the real 48-team schedule,
   the feed pill should read "Live · ESPN", Live/Completed empty, standings all 0.
3. **Live/final branch (optional):** temporarily change `RANGE`/league in `scores.mjs` to a
   league in season (e.g. `usa.1` MLS) to watch a real in-progress match map to `live`/`final`,
   then switch back to `fifa.world`.
4. **Demo still isolated:** `/demo/` should show the sample QF-day data and the gold
   "Demo · sample data" pill, with no network calls.

When the tournament starts, no changes are needed — the function flips matches to live/final
on its own and the cadence tightens automatically.

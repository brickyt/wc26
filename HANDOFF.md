# World Cup 2026 Scoreboard — Development Handoff

A live, public, auto-updating fantasy scoreboard for **The North End Podcast World Cup Pool 2026**.
Replaces the commissioner's manual Google Sheet. Built as a self-contained site; deploys free on Cloudflare Pages.

**Live site:** your Cloudflare Pages URL (e.g. `https://<project>.pages.dev/`)

---

## Current status
- ✅ Front-end fully built and iterated (mobile + desktop).
- ✅ ESPN feed verified against real 2026 data; team-join audit clean.
- ✅ Live-data function built, then migrated to a Cloudflare Pages Function (`functions/api/scores.js`).
- ✅ Rosters updated (Groups 1–4 and 6); Group 5 still drafting.
- ⏳ **Next:** push to the Cloudflare Pages repo, then run the pre-tournament smoke tests below.

---

## Project structure
```
public/index.html        # LIVE page  (const DEMO = false; fetches /api/scores)
public/demo/index.html   # DEMO page  (const DEMO = true; sample data, no network)
public/_routes.json      # only /api/* invokes the function; static stays on the free tier
functions/api/scores.js  # ESPN poller + mapper  ->  served at /api/scores
README.md                # deploy + smoke-test steps
```
The two HTML files are **identical except one line** (`const DEMO`). `false` = live, `true` = demo.
Routes once deployed: `/` = live, `/demo/` = mockup, `/api/scores` = raw JSON feed.

---

## Deploy steps (Cloudflare Pages, ~5 min)
1. Push this folder to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build command: none. Build output directory: `public`. Functions auto-detected from `functions/`.
   Auto-deploys on every push.
4. Site is at `https://<project>.pages.dev` (add a custom domain under **Custom domains** if desired).

## Smoke tests (do before June 11, 2026)
1. Open `https://<site>/api/scores` → JSON with `matches` full of real fixtures (all `status:"pre"`)
   and `unresolved` containing **only** the TBD bracket placeholders (group winners, "Round of 32 N
   Winner", etc.). If a real **country** appears in `unresolved`, add it to `NAME_ALIASES` or
   `ID_OVERRIDE` in `functions/api/scores.js`.
2. Open `/` → Upcoming fills with the real 48-team schedule; feed pill reads "Live · ESPN";
   Live/Completed empty; standings all 0.
3. (Optional) Live/final branch: temporarily change the league slug in `functions/api/scores.js` to
   `usa.1` (MLS, in season) to watch a real in-progress match map to `live`/`final`, then switch back to `fifa.world`.
4. `/demo/` still shows the sample QF-day data with the gold "Demo · sample data" pill, no network.

When the tournament starts, **no changes needed** — the function flips matches to live/final and the
cadence tightens automatically.

---

## Architecture
- **Static SPA + one serverless function.** The page calls `/api/scores` (a Cloudflare Pages
  Function). The function makes **one** call to ESPN's unofficial scoreboard for the whole
  tournament, maps each match to our shape, and returns JSON. The response is stored at the edge
  via the Cache API (`caches.default`) so every visitor on a Cloudflare colo shares a single ESPN call.
- **Adaptive cadence** (cache TTL): 60s while any match is live or kickoff is within 10 min;
  otherwise sleep until the next kickoff (cap 30 min); 1 hour once the tournament is over. The
  client mirrors this with `pollState()` and re-syncs on tab `visibilitychange`.
- **Fallback:** on a failed fetch the live page keeps last-good data and shows "Reconnecting…".
- **Future option:** keep the commissioner's Google Sheet as a manual override layer (not built yet).

### Match object shape (function output → what the page renders)
```js
{ stage:'group'|'R32'|'R16'|'QF'|'SF'|'3P'|'Final',
  group?:'A'..'L',           // only for group stage (derived from our roster data)
  home, away,                // OUR team names, or null = TBD bracket slot
  hs?, as?,                  // ints, present once not 'pre'
  status:'pre'|'live'|'final',
  dt,                        // ISO kickoff
  minute?,                   // live only: base minute (e.g. 90)
  plus?,                     // live only: stoppage minutes (e.g. 4 -> page shows 90'+4')
  clockText?,                // live only: ESPN clock verbatim when not parseable (e.g. "HT")
  pk?,                       // {h,a} shootout tally (live or final)
  winner? }                  // final only: 'home'|'away'|null (authoritative, pens-safe)
// function also returns: { updated, matches:[...], unresolved:[...] }
```

---

## ESPN API — verified facts (don't re-research)
- **Endpoint:** `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard`
  No API key. Params: `?dates=YYYYMMDD` or range `YYYYMMDD-YYYYMMDD`, `&limit=950`. League id `606`.
- The **2026 fixtures are already loaded** (confirmed June 2026). Broadcaster listed as **FOX**.
- Per event: `competitions[0].status.type.state` = `pre | in | post`; `competitors[]` each has
  `homeAway`, `score` (string), and `team.{id, abbreviation, displayName}`.
- **Stage windows** come from `leagues[0].calendar[0].entries` (each `{label,startDate,endDate}`):
  Group (Jun 11–27), Round of 32 (Jun 28–Jul 3), Rd of 16 (Jul 4–7), Quarterfinals (Jul 9–11),
  Semifinals (Jul 14–15), 3rd-Place Match (Jul 18), Final (Jul 19).
- **Team join:** ESPN's `abbreviation` == the FIFA codes we use, and `displayName` matches our names.
  Verified exact: Mexico/MEX (id 203), South Africa/RSA (467), South Korea/KOR (451), Czechia/CZE (450).
  Join order in the function: FIFA code → display name → `NAME_ALIASES` → `ID_OVERRIDE`; unmatched → `null` (TBD) and logged in `unresolved`.

---

## Scoring rules
- Group stage: Win **3**, Draw **1**, Loss **0**.
- Knockout **win**: R32 **3**, R16 **6**, QF **9**, SF **12**, Final **15**. (Winner only; no points for a KO loss.)
- **No** points for the 3rd-place match. Champion ceiling ≈ **54**.
- Standings currently count **final matches only** (there's an `INCLUDE_LIVE_IN_STANDINGS` seam to flip on
  live projections later; KO ties would need a "pending" rule since there are no KO draws).

---

## Pool data (embedded in both the page and the function)
3 pools, 12 managers, 8 teams each. User is **Ariaga II**. Standings show all 12 as **one combined
leaderboard** (no pool split in the UI).

**Pool 1** — Jorge: England, Argentina, Norway, Japan, Ecuador, Austria, Egypt, Paraguay · Dave S.: Portugal, Brazil, Mexico, USA, Canada, Senegal, Ghana, South Korea · Cagle: Spain, Netherlands, Croatia, Morocco, Switzerland, Sweden, Czechia, Australia · Chris C.: France, Germany, Belgium, Colombia, Uruguay, Türkiye, Scotland, Algeria
**Pool 2** — Brian: France, Brazil, Morocco, Croatia, USA, Austria, Iran, Australia · Ryan: Germany, Netherlands, Türkiye, Senegal, Uruguay, Japan, Côte d'Ivoire, Ghana · **Ariaga II (you): England, Argentina, Colombia, Ecuador, Mexico, Canada, Scotland, Sweden** · Tim: Spain, Portugal, Belgium, Norway, Switzerland, Egypt, South Korea, Czechia
**Pool 3** — Dave R.: Spain, Brazil, Norway, Colombia, Türkiye, Switzerland, Austria, South Korea · Birdman: Argentina, Germany, Netherlands, Croatia, Canada, Egypt, Scotland, Saudi Arabia · Aries: France, Belgium, Uruguay, USA, Ecuador, Côte d'Ivoire, Sweden, Ghana · Julian: England, Portugal, Morocco, Japan, Mexico, Senegal, Paraguay, Algeria

*(Competition may expand to 6–7 pools of 4. To add managers, edit the `POOLS` structure in the HTML.)*

### Groups (source of truth for the group letter)
A: Mexico, South Africa, South Korea, Czechia · B: Canada, Bosnia & Herzegovina, Qatar, Switzerland ·
C: Brazil, Morocco, Haiti, Scotland · D: USA, Paraguay, Australia, Türkiye · E: Germany, Curaçao,
Côte d'Ivoire, Ecuador · F: Netherlands, Japan, Sweden, Tunisia · G: Belgium, Egypt, Iran, New Zealand ·
H: Spain, Cape Verde, Saudi Arabia, Uruguay · I: France, Senegal, Iraq, Norway · J: Argentina, Algeria,
Austria, Jordan · K: Portugal, Congo DR, Uzbekistan, Colombia · L: England, Croatia, Ghana, Panama

### FIFA codes (name → code; used for single-line chips + ESPN join)
MEX RSA KOR CZE · CAN BIH QAT SUI · BRA MAR HAI SCO · USA PAR AUS TUR · GER CUW CIV ECU ·
NED JPN SWE TUN · BEL EGY IRN NZL · ESP CPV KSA URU · FRA SEN IRQ NOR · ARG ALG AUT JOR ·
POR COD UZB COL · ENG CRO GHA PAN
*(Non-obvious: Saudi Arabia=KSA, South Africa=RSA, Curaçao=CUW, Austria=AUT [Australia=AUS], DR Congo=COD, Iran=IRN.)*

---

## UI features built
- **Theme:** dark "matchday control room"; fonts Anton (display), Saira, Barlow Semi Condensed; trophy gold.
- **Standings:** single combined leaderboard of all managers (no pool sub-headers); gold highlight on
  overall #1; no "YOU" tag.
- **Two tooltips** (hover on desktop, tap on mobile): manager → points by real-world team; team → who
  owns it + their overall standing. TBD chips are non-interactive (no popup).
- **Three match panels:** Live, Upcoming, Completed. Match rows are single-line: flag + FIFA 3-letter code.
- **"Today only" toggle** lives in the Upcoming header and filters **Upcoming only** (not Live/Completed).
  Empty result → "No matches today."
- **Stage badges** in a consistent slot across all three panels:
  - Group: **GRP A**…**GRP L**, colored with the official colors sampled from the FIFA graphic, with
    per-group dark/white label text chosen for contrast.
  - Knockout, escalating, glow on the Final only:
    `R32` grey `#5c6675` · `R16` blue `#2f6fc0` · `QF` violet `#7b46d1` · `SF` orange `#e07d1c` ·
    `FINAL` gold `var(--gold)` + glow · `3RD · NO PTS` muted.
  - Badge text = round + points (e.g. "QF · 9 PTS").
- **Status pill** (header) reflects the poll state: "Live · every 60s" / "Sleeping · next update at
  {date time}" / "Tournament complete · updates off".
- **Feed pill** reflects data source: "Live · ESPN" / "Reconnecting…" / "Demo · sample data".

### Group accent colors (sampled hex)
A `#08e176` · B `#f7194a` · C `#f78f11` · D `#3954f6` · E `#5f02e6` · F `#c7fb0e` ·
G `#ef6193` · H `#64fcdb` · I `#aa46bb` · J `#317286` · K `#fa3d08` · L `#47b4ec`

---

## Open / future ideas (not built)
- Commissioner Google Sheet as a manual override/fallback source.
- Live in-progress projection in standings (flip `INCLUDE_LIVE_IN_STANDINGS`; handle KO "pending").
- Movement arrows (▲▼) after match days; live "+N" delta highlights.
- Per-pool view toggle if pools become separate prize competitions (currently one combined board).

## Notes / conventions
- Demo "today" is anchored to a quarterfinal day (`2026-07-05`) so all badge tiers are visible; the live
  page uses the real local date.
- If rosters, groups, codes, or colors change, update **both** the HTML and `functions/api/scores.js` (data is mirrored).
- The latest single-file iteration before packaging was `scoreboard-v10.html` (filenames were bumped
  v2→v10 only to dodge a viewer cache; irrelevant once in Git).

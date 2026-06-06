/* =================================================================
   ESPN -> scoreboard feed  (Netlify Function, runs server-side)
   -----------------------------------------------------------------
   - ONE request to ESPN's unofficial scoreboard per cache window.
   - The CDN caches our JSON (s-maxage), so every visitor shares the
     same single ESPN call — no per-client hammering of the endpoint.
   - Returns: { updated, matches:[...], unresolved:[...] }
       match = { stage, group?, home, away, hs?, as?, status, dt, minute? }
       home/away are OUR team names (or null = TBD bracket slot).
   - Cadence (s-maxage): 60s while live / near kickoff, else sleep to
     the next kickoff (cap 30 min), 1h once the tournament is over.
   ================================================================= */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const RANGE = '20260611-20260719'; // whole tournament in one call
const LIMIT = 950;

/* --- our 12 groups (source of truth for the group letter) --- */
const GROUPS = {
  A:['Mexico','South Africa','South Korea','Czechia'],
  B:['Canada','Bosnia & Herzegovina','Qatar','Switzerland'],
  C:['Brazil','Morocco','Haiti','Scotland'],
  D:['USA','Paraguay','Australia','Türkiye'],
  E:['Germany','Curaçao',"Côte d'Ivoire",'Ecuador'],
  F:['Netherlands','Japan','Sweden','Tunisia'],
  G:['Belgium','Egypt','Iran','New Zealand'],
  H:['Spain','Cape Verde','Saudi Arabia','Uruguay'],
  I:['France','Senegal','Iraq','Norway'],
  J:['Argentina','Algeria','Austria','Jordan'],
  K:['Portugal','Congo DR','Uzbekistan','Colombia'],
  L:['England','Croatia','Ghana','Panama'],
};
const TEAM_GROUP = {};
for (const [g, teams] of Object.entries(GROUPS)) for (const t of teams) TEAM_GROUP[t] = g;
const NAME_SET = new Set(Object.values(GROUPS).flat());

/* --- FIFA code -> our team name (primary, most stable join) --- */
const ABBR = {
  'Mexico':'MEX','South Africa':'RSA','South Korea':'KOR','Czechia':'CZE',
  'Canada':'CAN','Bosnia & Herzegovina':'BIH','Qatar':'QAT','Switzerland':'SUI',
  'Brazil':'BRA','Morocco':'MAR','Haiti':'HAI','Scotland':'SCO',
  'USA':'USA','Paraguay':'PAR','Australia':'AUS','Türkiye':'TUR',
  'Germany':'GER','Curaçao':'CUW',"Côte d'Ivoire":'CIV','Ecuador':'ECU',
  'Netherlands':'NED','Japan':'JPN','Sweden':'SWE','Tunisia':'TUN',
  'Belgium':'BEL','Egypt':'EGY','Iran':'IRN','New Zealand':'NZL',
  'Spain':'ESP','Cape Verde':'CPV','Saudi Arabia':'KSA','Uruguay':'URU',
  'France':'FRA','Senegal':'SEN','Iraq':'IRQ','Norway':'NOR',
  'Argentina':'ARG','Algeria':'ALG','Austria':'AUT','Jordan':'JOR',
  'Portugal':'POR','Congo DR':'COD','Uzbekistan':'UZB','Colombia':'COL',
  'England':'ENG','Croatia':'CRO','Ghana':'GHA','Panama':'PAN',
};
const CODE2NAME = {};
for (const [name, code] of Object.entries(ABBR)) CODE2NAME[code] = name;

/* --- display-name fallbacks (in case ESPN ever differs from our keys) --- */
const NAME_ALIASES = {
  'Ivory Coast':"Côte d'Ivoire", 'Cote d\u2019Ivoire':"Côte d'Ivoire",
  'Turkey':'Türkiye', 'Turkiye':'Türkiye',
  'Cabo Verde':'Cape Verde',
  'DR Congo':'Congo DR', 'Congo DR':'Congo DR', 'Democratic Republic of the Congo':'Congo DR',
  'United States':'USA', 'United States of America':'USA',
  'IR Iran':'Iran',
  'Korea Republic':'South Korea',
  'Czech Republic':'Czechia',
  'Bosnia and Herzegovina':'Bosnia & Herzegovina',
};
/* --- last-resort overrides keyed by ESPN numeric id (confirmed: none needed yet) --- */
const ID_OVERRIDE = {
  // '203':'Mexico', '467':'South Africa', '451':'South Korea', '450':'Czechia',
};

function resolveTeam(t, unresolved) {
  if (!t) return null;
  const code = (t.abbreviation || '').toUpperCase();
  if (CODE2NAME[code]) return CODE2NAME[code];
  if (t.displayName && NAME_SET.has(t.displayName)) return t.displayName;
  if (t.displayName && NAME_ALIASES[t.displayName]) return NAME_ALIASES[t.displayName];
  if (t.id && ID_OVERRIDE[t.id]) return ID_OVERRIDE[t.id];
  // real team we couldn't map (vs an intentional TBD placeholder) -> log it
  if (code || t.displayName) unresolved.push({ id: t.id, name: t.displayName, abbr: code });
  return null;
}

const LABEL2STAGE = {
  'Group':'group', 'Round of 32':'R32', 'Round of 16':'R16', 'Rd of 16':'R16',
  'Quarterfinals':'QF', 'Semifinals':'SF', '3rd-Place Match':'3P', 'Final':'Final',
};

/* Fixed 2026 stage windows (UTC), used as the primary source of the stage.
   ESPN's leagues[0].calendar currently comes back EMPTY, so deriving the stage
   from its labels would tag every match — including knockouts and the Final —
   as 'group'. The tournament dates are published and final, so we key the stage
   off each kickoff time instead. Each boundary sits in the idle gap between the
   last match of one round and the first of the next, so it's robust to the exact
   kickoff times. [stage, startInclusive, endExclusive]. */
const STAGE_WINDOWS = [
  ['group', '2026-06-11T00:00Z', '2026-06-28T12:00Z'],
  ['R32',   '2026-06-28T12:00Z', '2026-07-04T12:00Z'],
  ['R16',   '2026-07-04T12:00Z', '2026-07-08T12:00Z'],
  ['QF',    '2026-07-08T12:00Z', '2026-07-13T00:00Z'],
  ['SF',    '2026-07-13T00:00Z', '2026-07-16T12:00Z'],
  ['3P',    '2026-07-16T12:00Z', '2026-07-19T12:00Z'],
  ['Final', '2026-07-19T12:00Z', '2026-07-20T00:00Z'],
];

function stageOf(dateISO, entries) {
  const t = Date.parse(dateISO);
  // Primary: fixed tournament windows (works even when ESPN's calendar is empty).
  for (const [stage, s, e] of STAGE_WINDOWS) {
    if (t >= Date.parse(s) && t < Date.parse(e)) return stage;
  }
  // Fallback: ESPN's own calendar labels, if it ever starts providing them.
  for (const e of entries) {
    if (t >= Date.parse(e.startDate) && t < Date.parse(e.endDate)) return LABEL2STAGE[e.label] || 'group';
  }
  return 'group';
}

function mapEvent(ev, entries, unresolved) {
  const c = ev.competitions && ev.competitions[0];
  if (!c) return null;
  const comp = c.competitors || [];
  const homeC = comp.find(x => x.homeAway === 'home') || comp[0];
  const awayC = comp.find(x => x.homeAway === 'away') || comp[1];
  const state = c.status && c.status.type && c.status.type.state; // pre | in | post
  const status = state === 'in' ? 'live' : state === 'post' ? 'final' : 'pre';
  const home = resolveTeam(homeC && homeC.team, unresolved);
  const away = resolveTeam(awayC && awayC.team, unresolved);
  const m = { stage: stageOf(c.date || ev.date, entries), home, away, status, dt: c.date || ev.date };
  if (m.stage === 'group') { const g = TEAM_GROUP[home] || TEAM_GROUP[away]; if (g) m.group = g; }
  if (status !== 'pre') {
    m.hs = parseInt((homeC && homeC.score) || '0', 10) || 0;
    m.as = parseInt((awayC && awayC.score) || '0', 10) || 0;
  }
  if (status === 'live') {
    const dc = ((c.status && c.status.displayClock) || '').replace(/[^0-9]/g, '');
    m.minute = dc ? parseInt(dc, 10) : Math.round((c.status && c.status.clock) || 0);
  }
  return m;
}

function maxAge(matches) {
  const now = Date.now();
  if (matches.some(m => m.status === 'live')) return 60;
  const kicks = matches.filter(m => m.status === 'pre' && m.dt)
    .map(m => Date.parse(m.dt)).filter(t => t > now).sort((a, b) => a - b);
  if (!kicks.length) return 3600;                 // tournament over
  const secs = Math.round((kicks[0] - now) / 1000);
  if (secs <= 600) return 60;                      // within 10 min of kickoff
  return Math.min(secs, 1800);                     // sleep to next kickoff, cap 30 min
}

export default async () => {
  try {
    const r = await fetch(`${ESPN}?dates=${RANGE}&limit=${LIMIT}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('ESPN ' + r.status);
    const data = await r.json();
    const entries = (((data.leagues || [])[0] || {}).calendar || [])[0]?.entries || [];
    const unresolved = [];
    const matches = (data.events || []).map(ev => mapEvent(ev, entries, unresolved)).filter(Boolean);
    const body = JSON.stringify({ updated: new Date().toISOString(), matches, unresolved });
    const ma = maxAge(matches);
    return new Response(body, {
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=30',
        'netlify-cdn-cache-control': `public, s-maxage=${ma}, stale-while-revalidate=120`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), matches: [] }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
};

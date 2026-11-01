// Adds `photo` + `photoCredit` to every candidate in data/races.json, trying sources in priority order:
//   1. Official congressional portrait   (unitedstates/images, anyone with a bioguide id)
//   2. Wikipedia lead image              (via the article link scraped with the nominee list)
//   3. State legislature portrait        (OpenStates public people database; strict name + state + party match)
//   4. Campaign website portrait         (og:image from the candidate's own site, only from sites verified as theirs, and only when the file looks like a headshot)
//   5. Local override                    (public/photos/<fecId>.jpg|png|webp, credit in data/photo-credits.json): hand-picked photos always win
// Ballotpedia is deliberately NOT used: it serves automated clients a bot-check page and publishes no bulk-use policy. Ask editor@ballotpedia.org before using it.
// Candidates with none of these get null and the UI shows initials. Nothing is ever guessed: every match is verified.
import { readJSON, writeJSON, namesMatch, normName, firstNamesMatch, isBadSiteHost, DATA, CACHE, download } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const UA = { 'user-agent': 'election-hub/0.1 (non-commercial civic project; contact rahamghassemi@gmail.com)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STATE = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const doc = readJSON(`${DATA}/races.json`);
const slots = Object.values(doc.races).flatMap(r => r.candidates.map(c => ({ c, r })));
const credit = { official: 'Official congressional portrait', wikipedia: 'Wikipedia', state: 'State legislature', site: 'Campaign website', local: 'Provided' };
const stats = { official: 0, wikipedia: 0, state: 0, site: 0, local: 0, none: 0 };
const set = (c, photo, kind) => { c.photo = photo; c.photoCredit = credit[kind]; stats[kind]++; };

// ---------- 1 + 2: official portraits and Wikipedia lead images
const wikiThumb = new Map();
const titles = [...new Set(slots.filter(({ c }) => !c.bioguide && c.wiki).map(({ c }) => c.wiki))];
for (let i = 0; i < titles.length; i += 40) {
  const batch = titles.slice(i, i + 40);
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=300&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`;
  try {
    const j = await (await fetch(url, { headers: UA })).json();
    const redirect = new Map([...(j.query?.normalized || []), ...(j.query?.redirects || [])].map(x => [x.from, x.to]));
    const byTitle = new Map((j.query?.pages || []).map(p => [p.title, p.thumbnail?.source]));
    for (const t of batch) { let r = t; for (let k = 0; k < 3 && redirect.has(r); k++) r = redirect.get(r); wikiThumb.set(t, byTitle.get(r) || null); }
  } catch { /* leave unset; later sources may still match */ }
  await sleep(400);
}
const prev = new Map(slots.map(({ c }) => [c, { photo: c.photo, photoCredit: c.photoCredit }]));   // so a skipped (slow) step never erases what it found last time
for (const { c } of slots) {
  c.photo = null; c.photoCredit = null;
  if (c.bioguide) set(c, `https://unitedstates.github.io/images/congress/225x275/${c.bioguide}.jpg`, 'official');
  else if (c.wiki && wikiThumb.get(c.wiki)) set(c, wikiThumb.get(c.wiki), 'wikipedia');
}

// ---------- 3: state legislators (OpenStates public data)
const osDir = path.join(CACHE, 'os');
const osRoot = path.join(osDir, 'people-main', 'data');
if (!fs.existsSync(osRoot)) {
  fs.mkdirSync(osDir, { recursive: true });
  const tgz = await download('https://github.com/openstates/people/archive/refs/heads/main.tar.gz', 'os/people.tar.gz', 72);
  const { execFileSync } = await import('node:child_process');
  execFileSync('tar', ['-xzf', tgz, '-C', osDir, '*/data/*/legislature/*.yml']);
}
const legislators = [];
for (const st of fs.readdirSync(osRoot)) {
  const dir = path.join(osRoot, st, 'legislature'); if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.yml')) continue;
    const t = fs.readFileSync(path.join(dir, f), 'utf8'), g = re => (t.match(re) || [])[1];
    const image = g(/^image:\s*(\S+)/m); if (!image) continue;
    legislators.push({ st: st.toUpperCase(), name: (g(/^name:\s*(.+)$/m) || '').replace(/^['"]|['"]$/g, ''), party: g(/^party:\s*\n- name:\s*(.+)$/m) || '', image });
  }
}
/** strict: surname must match AND the first names must be equal (or one a >=3-letter prefix of the other); initials alone are never enough */
const sameFirst = (a, b) => firstNamesMatch(normName(a).first, normName(b).first);
const partyLetter = p => ({ D: 'Democratic', R: 'Republican' }[p?.[0]]);
const osCandidates = slots.filter(({ c }) => !c.photo);
for (const { c, r } of osCandidates) {
  const m = legislators.find(l => l.st === r.state && namesMatch(l.name, c.name) && sameFirst(l.name, c.name) && (!partyLetter(c.party) || !l.party || l.party.startsWith(partyLetter(c.party))));
  if (!m) continue;
  try { const h = await fetch(m.image, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(8000), redirect: 'follow' }); if (h.ok && /image/.test(h.headers.get('content-type') || '')) set(c, m.image, 'state'); } catch { /* dead or hotlink-blocked: skip */ }
}

// ---------- 3b: Wikipedia search for major-party nominees whose article the nominee page never linked.
// Accepted only if the article title contains the name AND its intro mentions the state and politics. Wrong-person hits are worse than no photo.
const POLITICS = /(candidate|congress|senate|house of representatives|politician|democratic|republican|legislature|mayor|governor|attorney|commissioner)/;
const SKIP_WIKI_SEARCH = process.env.SKIP_WIKI_SEARCH === '1';   // the slow step; skip when only campaign sites changed
for (const { c, r } of SKIP_WIKI_SEARCH ? [] : slots.filter(({ c }) => !c.photo && /^(D|R)(\/|$)/.test(c.party))) {
  const clean = c.name.replace(/\s+/g, ' ').trim(), n = normName(clean);
  const q = `"${clean}" ${STATE[r.state]} ${r.type === 'senate' ? 'Senate' : 'House of Representatives'} candidate`;
  const u = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=pageimages|extracts&piprop=thumbnail&pithumbsize=300&exintro=1&explaintext=1&exlimit=3&format=json&formatversion=2`;
  try {
    const j = await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(12000) })).json();
    const pages = (j.query?.pages || []).sort((a, b) => a.index - b.index);
    const hit = pages.find(p => { const t = p.title.toLowerCase(); return t.includes(n.lastTail) && t.includes(n.first.slice(0, 3)) && !/disambiguation|list of|election/.test(t); });
    const ex = (hit?.extract || '').toLowerCase();
    if (hit?.thumbnail && ex.includes(STATE[r.state].toLowerCase()) && POLITICS.test(ex)) set(c, hit.thumbnail.source, 'wikipedia');
  } catch { /* skip */ }
  await sleep(250);
}

// ---------- 4: campaign website portraits (identity verified by scripts/crawl-sites.mjs's rules: surname on the page or in the domain)
const sites = { ...readJSON(`${DATA}/sites.json`, {}), ...readJSON(`${DATA}/sites-discovered.json`, {}) };
for (const [k, v] of Object.entries(readJSON(`${DATA}/sites-manual.json`, {}))) { if (k.startsWith('_')) continue; if (v) sites[k] = v; else delete sites[k]; }
for (const k of Object.keys(sites)) if (isBadSiteHost(sites[k])) delete sites[k];
const decode = h => h.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
async function sitePortrait(c, site) {
  let res;
  try { res = await fetch(site, { headers: { ...UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12000) }); if (!res.ok) return null; } catch { return null; }
  const html = (await res.text()).slice(0, 1_000_000);
  const last = normName(c.name).lastTail, host = new URL(res.url).host.toLowerCase();
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').toLowerCase();
  if (!(host.includes(last) || text.split(last).length - 1 >= 3)) return null;               // not clearly this candidate's site
  const og = decode((html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1] || '');
  if (!og) return null;
  const img = new URL(og, res.url).href, file = img.split('?')[0].toLowerCase();
  // keep only things that look like a portrait: not a logo/banner/graphic, and the filename names the person or says headshot/portrait
  if (/logo|banner|icon|header|hero|graphic|share|social|cover|placeholder|default|flag/.test(file)) return null;
  if (!(file.includes(last) || /head-?shot|portrait|profile|candidate|photo/.test(file))) return null;
  try { const h = await fetch(img, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(8000), redirect: 'follow' }); if (!h.ok || !/image/.test(h.headers.get('content-type') || '')) return null; } catch { return null; }
  return img;
}
for (const { c, r } of slots.filter(({ c }) => !c.photo)) {
  const site = sites[c.fecId || `${c.name}|${r.state}`]; if (!site) continue;
  const img = await sitePortrait(c, site);
  if (img) set(c, img, 'site');
  await sleep(500);
}

// ---------- 5: local overrides (hand-picked photos always win)
const creditsFile = readJSON(`${DATA}/photo-credits.json`, {});
for (const { c, r } of slots) {
  for (const key of [c.fecId, `${c.name}|${r.state}`].filter(Boolean)) {
    const ext = ['jpg', 'jpeg', 'png', 'webp'].find(e => fs.existsSync(path.join(import.meta.dirname, '..', 'public', 'photos', `${key.replace(/[^\w|-]/g, '_')}.${e}`)));
    if (ext) { if (!c.photo) stats.none--; c.photo = `/photos/${encodeURIComponent(key.replace(/[^\w|-]/g, '_'))}.${ext}`; c.photoCredit = creditsFile[key] || credit.local; stats.local++; break; }
  }
}

if (SKIP_WIKI_SEARCH) for (const { c } of slots) if (!c.photo && prev.get(c)?.photo) { c.photo = prev.get(c).photo; c.photoCredit = prev.get(c).photoCredit; }
for (const { c } of slots) if (!c.photo) stats.none++;
writeJSON(`${DATA}/races.json`, doc);
console.log('photos:', stats);

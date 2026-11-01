// Which races matter most this cycle: pulled from the forecasters' ratings (Cook, Sabato, Inside Elections, etc.) that Wikipedia tabulates on each state's 2026 page.
//   House:  important if any forecaster rates it Toss-up, Tilt or Lean.      Senate: important if any forecaster rates it Likely or closer.
// Output: data/important-races.json  { "MI-7": { level: "lean", ratings: ["Lean","Lean"] }, ... }
import fs from 'node:fs';
import { readJSON, writeJSON, CACHE, DATA, STATES } from './lib.mjs';

const order = { tossup: 0, tilt: 1, lean: 2, likely: 3, solid: 4, safe: 4 };   // lower = closer
const norm = s => { const k = s.toLowerCase().replace(/[^a-z]/g, ''); return k.startsWith('toss') ? 'tossup' : k.startsWith('tilt') ? 'tilt' : k.startsWith('lean') ? 'lean' : k.startsWith('likely') ? 'likely' : k.startsWith('solid') ? 'solid' : k.startsWith('safe') ? 'safe' : null; };
const wt = f => { try { return JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')).parse?.wikitext || ''; } catch { return ''; } };
const ratingsIn = chunk => [...chunk.matchAll(/\{\{USRaceRating\|([^|}]+)\|/g)].map(m => norm(m[1])).filter(Boolean);
const out = {};
const record = (key, ratings, kind) => {
  if (!ratings.length) return;
  const closest = Math.min(...ratings.map(r => order[r]));
  const important = kind === 'house' ? closest <= 2 : closest <= 3;
  if (important) out[key] = { level: Object.keys(order).find(k => order[k] === closest), ratings };
};
for (const st of Object.keys(STATES)) {
  for (const f of fs.readdirSync(CACHE).filter(f => f.startsWith(`wiki-house-${st}-`))) {
    const t = wt(f);
    const heads = [...t.matchAll(/\n==\s*(?:District (\d+)|At-large[^=]*)\s*==/g)];
    heads.forEach((h, i) => record(`${st}-${h[1] ? Number(h[1]) : 'AL'}`, ratingsIn(t.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : t.length)), 'house'));
    if (!heads.length && t) record(`${st}-AL`, ratingsIn(t), 'house');
  }
  for (const [suffix, f] of [['S', `wiki-senate-${st}-S.json`], ['S2', `wiki-senate-${st}-S2.json`]]) { const t = wt(f); if (t) record(`${st}-${suffix}`, ratingsIn(t), 'senate'); }
}
// only races that actually exist in our data
const { races } = readJSON(`${DATA}/races.json`);
for (const k of Object.keys(out)) if (!races[k]) delete out[k];
writeJSON(`${DATA}/important-races.json`, out);
const house = Object.keys(out).filter(k => !k.includes('-S')), sen = Object.keys(out).filter(k => k.includes('-S'));
console.log(`important races: ${house.length} House, ${sen.length} Senate`);
console.log('Senate:', sen.map(k => `${k}(${out[k].level})`).join(' '));
console.log('House toss-ups:', house.filter(k => out[k].level === 'tossup').join(' '));

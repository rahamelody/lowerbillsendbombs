// Writes data/endorsed.json: the candidates this project endorses, which feed the portraits at the top of the home page.
// The file is meant to be EDITED BY HAND (add/remove entries freely). This script only SEEDS it, and refuses to overwrite an existing file unless run with --force.
// Seed rule (a starting point, not a verdict): on the 2026 ballot, a portrait available, a record on at least 3 of the 4 issues,
// every one of those records aligned (dark green) or partially aligned (light green), and no AIPAC-linked money.
//   node scripts/seed-endorsed.mjs --add    adds any newly qualifying candidates to the existing file WITHOUT touching your edits or removals of other entries
//   node scripts/seed-endorsed.mjs --force  rebuilds the whole file from the rule (overwrites hand edits)
import fs from 'node:fs';
import { DATA, writeJSON } from './lib.mjs';
import { load } from '../lib/load.mjs';

const file = `${DATA}/endorsed.json`;
const add = process.argv.includes('--add');
if (fs.existsSync(file) && !add && !process.argv.includes('--force')) { console.log('data/endorsed.json already exists; edit it by hand, or re-seed with --force.'); process.exit(0); }
const app = load();
const seen = new Map();
for (const race of Object.values(app.races)) for (const c0 of race.candidates) {
  if (!c0.photo) continue;
  const c = app.enrichCandidate(c0), rec = c.record;
  const rated = ['health', 'housing', 'iran', 'israel'].map(t => rec[t].badge?.tier).filter(Boolean);
  if (rated.length >= 3 && rated.every(t => t === 'full' || t === 'partial') && rec.money.tier !== 'against') {
    const id = c.bioguide || c.fecId || c.name;
    if (!seen.has(id)) seen.set(id, { id, name: c.name, race: race.key, party: c.party });
  }
}
const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const readme = 'Candidates this project endorses. The home page portraits are drawn at random from this list, and clicking one opens their record. Edit freely: keep or delete entries, or add { "id": "<bioguide or FEC id>", "name": "...", "race": "XX-1" }. "id" is what matters; the other fields are for you. Whatever is listed, the home page only shows a candidate whose CURRENT record is aligned or partially aligned on every issue we have a record for and who took no AIPAC-linked money. Seeded by scripts/seed-endorsed.mjs.';
if (add && existing) {
  const have = new Set(existing.endorsed.map(e => e.id)); let n = 0;
  for (const e of seen.values()) if (!have.has(e.id)) { existing.endorsed.push(e); n++; }
  existing.endorsed.sort((a, b) => a.name.localeCompare(b.name)); existing._readme = readme;
  writeJSON(file, existing); console.log(`added ${n} newly qualifying candidates (${existing.endorsed.length} total)`);
} else {
  writeJSON(file, { _readme: readme, endorsed: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  console.log(`seeded ${seen.size} endorsed candidates into data/endorsed.json`);
}

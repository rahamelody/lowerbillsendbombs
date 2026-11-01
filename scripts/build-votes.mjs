// Builds data/votes.json (member -> key votes) from Voteview bulk CSVs, using the curated list in data/key-votes.json.
// Voteview rollnumber == the sequential roll number within a chamber+congress (differs from the Clerk's per-session numbers).
import { download, csvObjects, readJSON, writeJSON, DATA } from './lib.mjs';
import fs from 'node:fs';

const keyVotes = readJSON(`${DATA}/key-votes.json`, []);
const congresses = [...new Set(keyVotes.map(v => v.congress))];
const CAST = { 1: 'Yea', 2: 'Yea', 3: 'Yea', 4: 'Nay', 5: 'Nay', 6: 'Nay' };
const out = {};      // bioguide -> { voteId: 'Yea'|'Nay'|'Absent' }
const members119 = new Set();   // everyone who served in the 119th Congress (to tell "member who didn't cosponsor" from "not in Congress")
const tally = {};    // voteId -> {yea, nay, result, date}
for (const c of congresses) {
  const base = `https://voteview.com/static/data/out`;
  const members = csvObjects(fs.readFileSync(await download(`${base}/members/HS${c}_members.csv`, `HS${c}_members.csv`, 12), 'utf8'));
  const rolls = csvObjects(fs.readFileSync(await download(`${base}/rollcalls/HS${c}_rollcalls.csv`, `HS${c}_rollcalls.csv`, 12), 'utf8'));
  const wanted = new Map(keyVotes.filter(v => v.congress === c).map(v => [`${v.chamber === 'house' ? 'House' : 'Senate'}|${v.roll}`, v]));
  // sanity: the roll call we curated must still match what Voteview says
  for (const r of rolls) {
    const v = wanted.get(`${r.chamber}|${Number(r.rollnumber)}`);
    if (v) { tally[v.id] = { yea: +r.yea_count, nay: +r.nay_count, result: r.vote_result, date: r.date }; if (r.date !== v.date) console.warn('date mismatch', v.id, r.date, v.date); }
  }
  if (c === 119) members.forEach(m => m.bioguide_id && members119.add(m.bioguide_id));
  const byIcpsr = new Map(members.filter(m => m.bioguide_id).map(m => [`${m.chamber}|${m.icpsr}`, m.bioguide_id]));
  const memberIds = new Set(byIcpsr.keys());
  const text = fs.readFileSync(await download(`${base}/votes/HS${c}_votes.csv`, `HS${c}_votes.csv`, 12), 'utf8');
  const lines = text.split('\n'); const head = lines[0].split(',');
  const iC = head.indexOf('chamber'), iR = head.indexOf('rollnumber'), iI = head.indexOf('icpsr'), iK = head.indexOf('cast_code');
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(','); if (f.length < 4) continue;
    const v = wanted.get(`${f[iC]}|${Number(f[iR])}`); if (!v) continue;
    const bio = byIcpsr.get(`${f[iC]}|${f[iI]}`); if (!bio) continue;
    (out[bio] ||= {})[v.id] = CAST[f[iK]] || 'Absent';
  }
}
writeJSON(`${DATA}/votes.json`, { votes: out, tally, members119: [...members119] });
console.log(`votes: ${Object.keys(out).length} members, ${Object.keys(tally).length}/${keyVotes.length} roll calls matched`);

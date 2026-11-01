// State-legislature records for candidates who are (or were this session) state legislators, from the LegiScan API (free key: LEGISCAN_API_KEY in .env).
//   1. match our candidates to LegiScan legislators (same state, same surname, same first name, same party: ambiguous matches are skipped)
//   2. find the bills in that state's current session whose title/summary matches a STRICT rule on our issues (single-payer, tenant protections, settlements...)
//   3. record each matched legislator's sponsorship/cosponsorship and any floor votes on those bills, with links
// Output: data/state-records.json, keyed "Name|ST". Nothing is guessed: a bill only counts if its own title/summary matches a rule below.
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON, normName, namesMatch, firstNamesMatch, DATA, CACHE } from './lib.mjs';

// ---- key + cached API access (the key only ever goes to api.legiscan.com)
const envFile = path.join(import.meta.dirname, '..', '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const KEY = process.env.LEGISCAN_API_KEY;
if (!KEY) { console.error('No LEGISCAN_API_KEY in .env (free key: https://legiscan.com/legiscan)'); process.exit(1); }
const dir = path.join(CACHE, 'legiscan'); fs.mkdirSync(dir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
async function ls(op, params = {}, maxAgeH = 20) {
  const f = path.join(dir, `${op}-${Object.values(params).join('_')}.json`);
  if (fs.existsSync(f) && (Date.now() - fs.statSync(f).mtimeMs) / 36e5 < maxAgeH) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const q = new URLSearchParams({ key: KEY, op, ...params });
  let j;
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(`https://api.legiscan.com/?${q}`, { signal: AbortSignal.timeout(120000) }); calls++; j = await r.json(); if (j.status === 'OK') break; } catch { /* retry */ }
    await sleep(1500 * (a + 1));
  }
  if (j?.status !== 'OK') return null;
  fs.writeFileSync(f, JSON.stringify(j)); await sleep(120);
  return j;
}

// ---- strict topic rules. `aligned: true` means supporting the bill is aligned with this guide's priorities; false means supporting it is NOT.
// A bill that matches nothing here is ignored. Ambiguous bills (e.g. generic "boycott-based adverse action" with no mention of Israel) are deliberately left out.
const RULES = [
  { topic: 'health', aligned: true, tier: 'full', what: 'single-payer health care', re: /new york health (program|act|plan)|single[- ]payer|medicare for all|universal health ?care|universal health coverage/i },
  { topic: 'housing', aligned: true, tier: 'full', what: 'tenant protections / social housing', re: /social housing|good cause (for )?evict|(civil )?right to counsel[^.]{0,60}evict|tenant opportunity to purchase|tenants'? (bill of rights|organizing)|housing access voucher|housing (is|as) a (human )?right|rent emergency|stabilization for tenants|rent control policies|(enacts|establishes|extends|expands|strengthens)[^.]{0,40}rent (stabilization|control)|(corporate|institutional|private equity) (landlord|ownership)/i },
  { topic: 'israel', aligned: true, tier: 'partial', what: 'ending funding of settlement activity', re: /settler violence|israeli settlement activity|support of israeli settlement/i },
  { topic: 'israel', aligned: false, tier: 'against', what: 'penalizing boycotts of Israel', re: /boycott[^.]{0,40}israel|israel[^.]{0,40}boycott|anti[- ]boycott|boycotting israel/i },
];
// never count: study requests, task forces, ceremonial resolutions, budget/omnibus bills (a vote on those says nothing about the issue), or technical amendments
const EXCLUDE = /\b(study|studies)\b|task force|memorializ|commemorat|proclaim|budget|appropriat|enacts into law major components|technical (changes|amendments)|chapter amendment/i;
const ruleFor = b => { const t = b.title || ''; return EXCLUDE.test(t) ? null : RULES.find(r => r.re.test(t)); };

// ---- candidates and states
const { races } = readJSON(`${DATA}/races.json`);
const cands = [];
for (const r of Object.values(races)) for (const c of r.candidates) if (!c.bioguide) cands.push({ c, state: r.state, race: r.key });
const states = [...new Set(cands.map(x => x.state))].sort();
const partyLetter = p => ({ D: 'D', R: 'R' }[p?.[0]]);
const sameFirst = (a, b) => firstNamesMatch(normName(a).first, normName(b).first);

// 1) match candidates to current-session legislators
const matched = [];   // { key, person, state, sessionId }
const sessions = {};
for (const st of states) {
  const sl = await ls('getSessionList', { state: st }, 72);
  const sess = (sl?.sessions || []).filter(s => !s.special && s.year_end >= 2026).sort((a, b) => b.year_end - a.year_end)[0];
  if (!sess) continue;
  sessions[st] = sess.session_id;
  const sp = await ls('getSessionPeople', { id: sess.session_id }, 72);
  const people = sp?.sessionpeople?.people || [];
  for (const { c, state, race } of cands.filter(x => x.state === st)) {
    const hits = people.filter(p => namesMatch(`${p.last_name}, ${p.first_name}`, c.name) && sameFirst(`${p.last_name}, ${p.first_name}`, c.name) && (!partyLetter(c.party) || !p.party || p.party === partyLetter(c.party)));
    if (hits.length === 1) matched.push({ key: `${c.name}|${state}`, person: hits[0], state, sessionId: sess.session_id, race });
  }
}
console.log(`matched ${matched.length} candidates to state legislators in ${new Set(matched.map(m => m.state)).size} states (${calls} API calls so far)`);

// 2) topic bills per state that has at least one matched legislator
const out = {};
for (const st of [...new Set(matched.map(m => m.state))]) {
  const ml = (await ls('getMasterList', { id: sessions[st] }, 20))?.masterlist || {};
  const bills = Object.values(ml).filter(b => b && b.bill_id).map(b => ({ b, rule: ruleFor(b) })).filter(x => x.rule);
  const mine = new Map(matched.filter(m => m.state === st).map(m => [m.person.people_id, m]));
  for (const { b, rule } of bills) {
    const full = (await ls('getBill', { id: b.bill_id }, 20))?.bill; if (!full) continue;
    const link = full.state_link || full.url || b.url;
    for (const sp of full.sponsors || []) {
      const m = mine.get(sp.people_id); if (!m) continue;
      (out[m.key] ||= { people_id: m.person.people_id, name: m.person.name, chamber: m.person.role === 'Sen' ? 'Senate' : 'House/Assembly', district: m.person.district, state: st, rows: [] })
        .rows.push({ topic: rule.topic, aligned: rule.aligned, tier: rule.tier, what: rule.what, role: sp.sponsor_type_id === 1 ? 'Sponsor' : 'Cosponsor', bill: full.bill_number, title: full.title, url: link, session: full.session?.session_name });
    }
    for (const v of full.votes || []) {   // floor votes on this bill
      const rc = (await ls('getRollCall', { id: v.roll_call_id }, 72))?.roll_call; if (!rc) continue;
      for (const pv of rc.votes || []) {
        const m = mine.get(pv.people_id); if (!m || !/^(yea|nay)$/i.test(pv.vote_text)) continue;
        (out[m.key] ||= { people_id: m.person.people_id, name: m.person.name, chamber: m.person.role === 'Sen' ? 'Senate' : 'House/Assembly', district: m.person.district, state: st, rows: [] })
          .rows.push({ topic: rule.topic, aligned: rule.aligned, tier: rule.tier, what: rule.what, vote: /^yea$/i.test(pv.vote_text) ? 'Yea' : 'Nay', bill: full.bill_number, title: full.title, url: link, date: v.date, result: `${v.yea}–${v.nay}` });
      }
    }
  }
  console.log(`${st}: ${bills.length} topic bills, ${[...mine.values()].filter(m => out[m.key]).length}/${mine.size} matched legislators have a relevant record (${calls} calls)`);
}
for (const rec of Object.values(out)) {
  const latest = new Map();
  for (const r of rec.rows) if (r.vote) { const k = r.bill; if (!latest.has(k) || (r.date || '') > (latest.get(k).date || '')) latest.set(k, r); }
  rec.rows = [...rec.rows.filter(r => !r.vote), ...latest.values()];
}
for (const rec of Object.values(out)) rec.url = `https://legiscan.com/${rec.state}/people/${rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}/id/${rec.people_id}`;
writeJSON(`${DATA}/state-records.json`, { generated: new Date().toISOString(), records: out });
console.log(`state-records.json: ${Object.keys(out).length} candidates with a relevant state record`);

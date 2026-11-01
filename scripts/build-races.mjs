// Joins nominees + FEC candidate ids + legislator ids + money into data/races.json (one record per race).
import { download, unzip, readJSON, writeJSON, namesMatch, normName, firstNamesMatch, DATA, CACHE } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const nominees = readJSON(`${DATA}/nominees.json`);
const { money, generated, filingsThrough, liveCheckedAt } = readJSON(`${DATA}/money.json`);
const { votes } = readJSON(`${DATA}/votes.json`);
const overrides = readJSON(`${DATA}/overrides.json`, {});
const industryMoney = readJSON(`${DATA}/industry.json`, { money: {} }).money;

// --- legislators (current + historical) for bioguide <-> FEC ids
const L = 'https://unitedstates.github.io/congress-legislators';
const read = async (f) => JSON.parse(fs.readFileSync(await download(`${L}/${f}`, f, 24), 'utf8'));
const current = await read('legislators-current.json');
const historical = await read('legislators-historical.json');
current.forEach(p => { p.isCurrent = true; });
const people = [...current, ...historical.filter(p => p.terms.at(-1).end >= '2009')];
const byFec = new Map(), byState = new Map();
for (const p of people) {
  for (const f of p.id.fec || []) byFec.set(f, p);
  const st = p.terms.at(-1).state; (byState.get(st) || byState.set(st, []).get(st)).push(p);
}
const seatHolder = new Map();   // "MI-11" / "GA-S" -> current member, so nicknames in candidate names can't hide an incumbent
for (const p of current) { const t = p.terms.at(-1); seatHolder.set(t.type === 'sen' ? `${t.state}-S-${t.class}` : `${t.state}-${Number(t.district) || 'AL'}`, p); if (t.type === 'sen') seatHolder.set(`${t.state}-S`, [...(seatHolder.get(`${t.state}-S`) || []), p]); }
const fullName = p => `${p.name.nickname || p.name.first} ${p.name.last}`;

// --- FEC candidate master (2026 cycle)
const zip = await download('https://www.fec.gov/files/bulk-downloads/2026/cn26.zip', 'cn26.zip', 12);
unzip(zip, path.join(CACHE, 'cn26'));
const fecByRace = new Map();
for (const line of fs.readFileSync(path.join(CACHE, 'cn26', 'cn.txt'), 'utf8').split('\n')) {
  const f = line.split('|'); if (f.length < 8 || f[3] !== '2026') continue;
  const key = f[5] === 'S' ? `${f[4]}-S` : `${f[4]}-${Number(f[6]) || 'AL'}`;
  (fecByRace.get(key) || fecByRace.set(key, []).get(key)).push({ id: f[0], name: f[1], party: f[2], ici: f[7] });
}

const sumMoney = ids => {
  const out = { direct: {}, ieSupport: {}, ieOppose: {}, conduitSupport: {}, conduitOppose: {} };
  for (const id of new Set(ids)) for (const k of Object.keys(out)) for (const [cy, amt] of Object.entries(money[id]?.[k] || {})) out[k][cy] = (out[k][cy] || 0) + amt;
  return out;
};
const sumIndustry = ids => {
  const out = { health: {}, realestate: {}, defense: {} };
  for (const id of new Set(ids)) for (const k of Object.keys(out)) for (const [cy, amt] of Object.entries(industryMoney[id]?.[k] || {})) out[k][cy] = (out[k][cy] || 0) + amt;
  return out;
};
const total = o => Object.values(o).reduce((a, b) => a + b, 0);

// total receipts per candidate (FEC all-candidates summary), used as a viability signal for what's shown by default
const wbZip = await download('https://www.fec.gov/files/bulk-downloads/2026/weball26.zip', 'weball26.zip', 20);
unzip(wbZip, path.join(CACHE, 'weball26'));
const receipts = {};
for (const line of fs.readFileSync(path.join(CACHE, 'weball26', 'weball26.txt'), 'utf8').split('\n')) { const f = line.split('|'); if (f[0] && f[5]) receipts[f[0]] = Number(f[5]) || 0; }
const FEATURED_MIN_RECEIPTS = 100000;
const prevPhotos = new Map();   // keep photos across quick refreshes (build-photos.mjs is the slow step)
for (const r of Object.values(readJSON(`${DATA}/races.json`, { races: {} }).races)) for (const c of r.candidates) if (c.photo) prevPhotos.set(`${r.key}|${c.name}`, { photo: c.photo, photoCredit: c.photoCredit });
const races = {};
for (const [key, race] of Object.entries(nominees)) {
  const fecKey = race.type === 'senate' ? `${race.state}-S` : key;
  const pool = fecByRace.get(fecKey) || [];
  const candidates = [];
  for (const c of race.candidates) {
    if (/^(TBD|TBA|none|total|majority|plurality)$/i.test(c.name.trim())) continue;
    const incumbentFlag = /\(incumbent\)/i.test(c.name) || /incumbent/i.test(c.note || '');
    const name = c.name.replace(/\s*\(incumbent\)/i, '').replace(/\[\[|\]\]/g, '').trim();
    const fec = pool.filter(p => namesMatch(p.name, name)).sort((a, b) => (b.party?.startsWith(c.party) ? 1 : 0) - (a.party?.startsWith(c.party) ? 1 : 0))[0];
    let person = (fec && byFec.get(fec.id)) || null;
    if (!person) {
      const holders = race.type === 'senate' ? (seatHolder.get(`${race.state}-S`) || []) : [seatHolder.get(key)].filter(Boolean);
      person = holders.find(p => normName(name).all.includes(normName(p.name.last).lastTail) || namesMatch(`${p.name.last}, ${p.name.first}`, name)) || null;
    }
    if (!person) person = (byState.get(race.state) || []).find(p => p.id.bioguide && [p.name.first, p.name.nickname, p.name.middle].filter(Boolean).some(f => namesMatch(`${p.name.last}, ${f}`, name))) || null;
    // Wikipedia sometimes lists a different person with a matching surname — require first initial to agree
    // a FORMER member must match on the whole first name (or a nickname / a >=3-letter prefix), never just the first initial ("Shannon Taylor" is not "Scott Taylor")
    if (person && !person.isCurrent) {
      const mine = normName(name).first;
      if (!mine || ![person.name.first, person.name.nickname, person.name.middle].filter(Boolean).some(f => firstNamesMatch(f, mine))) person = null;
    }
    const bioguide = person?.id.bioguide || null;
    const fecIds = [fec?.id, ...(person?.id.fec || [])].filter(Boolean);
    const lastTerm = person?.terms.at(-1);
    const sittingHere = person?.isCurrent && lastTerm && ((race.type === 'senate' && lastTerm.type === 'sen') || (race.type === 'house' && lastTerm.type === 'rep' && (Number(lastTerm.district) || 0) === race.district)) && lastTerm.state === race.state;
    const m = sumMoney(fecIds);
    const r = {
      name: person ? fullName(person) : name,
      party: c.party,
      incumbent: !!(incumbentFlag || sittingHere),
      formerMember: !!(person && !person.isCurrent),
      sittingElsewhere: person?.isCurrent && !sittingHere ? (lastTerm.type === 'sen' ? 'U.S. Senate' : 'U.S. House') : null,
      bioguide, fecId: fec?.id || null,
      hasVotes: !!(bioguide && votes[bioguide]),
      money: m, industry: sumIndustry(fecIds),
      moneyTotals: { direct: total(m.direct), ieSupport: total(m.ieSupport), ieOppose: total(m.ieOppose), conduitSupport: total(m.conduitSupport), conduitOppose: total(m.conduitOppose) },
      receipts: Math.round(Math.max(0, ...fecIds.map(id => receipts[id] || 0))),
      fromList: !!c.fromList,
      state: race.state,
      wiki: c.wiki || null,
    };
    r.featured = /^(D|R)(\/|$)/.test(r.party) || r.incumbent || r.hasVotes || r.receipts >= FEATURED_MIN_RECEIPTS;
    candidates.push(r);
  }
  for (const c of candidates) Object.assign(c, prevPhotos.get(`${key}|${c.name}`) || {});
  // fusion tickets list one person under several parties: merge them
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = candidates.findIndex((x, k) => k < i && x.name === candidates[i].name);
    if (j >= 0) { if (candidates[i].party !== 'Total' && !candidates[j].party.split('/').includes(candidates[i].party)) candidates[j].party += '/' + candidates[i].party; candidates.splice(i, 1); }
  }
  candidates.forEach(c => { c.party = c.party.split('/').filter(x => x !== 'Total').join('/'); });
  // never show a race as a one-person contest because of the collapse rule: promote the best-funded others until two are shown
  for (const c of [...candidates].filter(c => !c.featured).sort((a, b) => b.receipts - a.receipts)) { if (candidates.filter(x => x.featured).length >= 2) break; c.featured = true; }
  // keep the order: incumbent first, then by party D/R first
  const rank = c => (c.incumbent ? 0 : 1) * 10 + ({ D: 0, R: 1 }[c.party] ?? 2);
  candidates.sort((a, b) => rank(a) - rank(b));
  races[key] = { key, type: race.type, state: race.state, district: race.district ?? null, special: !!race.special, openSeat: !candidates.some(c => c.incumbent), candidates, ...(overrides[key] || {}) };
}
// --- Sitting members who are NOT on a 2026 general-election ballot (retiring House members, senators not up this year).
// Kept so "elected officials" are searchable even when they aren't running.
const onBallot = new Set(Object.values(races).flatMap(r => r.candidates.map(c => c.bioguide)).filter(Boolean));
const LETTER = { Democrat: 'D', Republican: 'R', Independent: 'I' };
const offBallot = current.filter(p => !onBallot.has(p.id.bioguide)).map(p => {
  const t = p.terms.at(-1), m = sumMoney(p.id.fec || []);
  return {
    name: fullName(p), party: LETTER[t.party] || t.party, bioguide: p.id.bioguide, state: t.state,
    chamber: t.type === 'sen' ? 'senate' : 'house', district: t.type === 'rep' ? Number(t.district) || 0 : null,
    termEnds: t.end, incumbent: true, formerMember: false, fecId: (p.id.fec || []).at(-1) || null, hasVotes: !!votes[p.id.bioguide],
    money: m, industry: sumIndustry(p.id.fec || []), moneyTotals: { direct: total(m.direct), ieSupport: total(m.ieSupport), ieOppose: total(m.ieOppose), conduitSupport: total(m.conduitSupport), conduitOppose: total(m.conduitOppose) },
    photo: `https://unitedstates.github.io/images/congress/225x275/${p.id.bioguide}.jpg`, notOnBallot: true,
  };
});
writeJSON(`${DATA}/people.json`, offBallot);
console.log(`people not on ballot: ${offBallot.length}`);
writeJSON(`${DATA}/races.json`, { generated: new Date().toISOString(), moneyAsOf: generated, filingsThrough, liveCheckedAt, races });
const all = Object.values(races).flatMap(r => r.candidates);
console.log(`races: ${Object.keys(races).length}; candidates: ${all.length}; with FEC id: ${all.filter(c => c.fecId).length}; incumbents: ${all.filter(c => c.incumbent).length}; with votes: ${all.filter(c => c.hasVotes).length}`);
console.log('incumbent House races lacking votes:', Object.values(races).filter(r => r.type === 'house').flatMap(r => r.candidates.filter(c => c.incumbent && !c.hasVotes).map(c => `${r.key}:${c.name}`)).join(', '));
